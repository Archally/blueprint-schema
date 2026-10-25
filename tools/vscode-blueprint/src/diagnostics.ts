import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { resolveModelReferences, deriveIdSpaces } from '@archally-blueprint-validator/core/cross-references.mjs';
import type { SourceLocator } from '@archally-blueprint-validator/core/cross-references.mjs';
import { deriveReferenceKeys } from '@archally-blueprint-validator/core/reference-keys.mjs';
import { loadSchemaRegistry } from '@archally-blueprint-validator/core/schema-registry.mjs';
import { classifyModelFiles } from '@archally-blueprint-validator/core/file-membership.mjs';
import { parseSource, sourceRange, type ParsedSource } from './diagnosticRanges';

export type Severity = 'error' | 'warning' | 'information' | 'hint' | 'off';
export interface DiagnosticSettings { duplicateSeverity: Severity; danglingSeverity: Severity }
export const DEFAULT_DIAGNOSTIC_SETTINGS: DiagnosticSettings = { duplicateSeverity: 'error', danglingSeverity: 'error' };
export const DEFAULT_DEBOUNCE_MS = 300;
export const MAX_DEBOUNCE_MS = 5000;
export const BUNDLED_SCHEMA_VERSION = 'v2.8';
export interface DiagnosticLocation { file: string; range: [number, number]; line: number }
export interface ModelDiagnostic extends DiagnosticLocation {
  code: 'duplicate-id' | 'dangling-reference' | 'schema-unavailable' | 'schema-version-conflict';
  severity: Exclude<Severity, 'off'>;
  message: string;
  related: DiagnosticLocation[];
}

export function owningModelRoot(file: string): string | undefined {
  const normalized = file.replace(/\\/g, '/');
  const matches = [...normalized.matchAll(/(?:^|\/)\.blueprint\/v\d+(?:\.\d+)?(?=\/)/g)];
  const match = matches[matches.length - 1];
  return match ? path.normalize(normalized.slice(0, match.index! + match[0].length)) : undefined;
}
export function selectSchema(root: string, declaration?: string, override?: string) {
  const directory = path.basename(root);
  const declared = typeof declaration === 'string' ? declaration.match(/^(\d+)\.(\d+)/) : undefined;
  const declaredVersion = declared ? `v${declared[1]}.${declared[2]}` : undefined;
  if (override) return { version: override.startsWith('v') ? override : `v${override}`, conflict: false };
  if (/^v\d+\.\d+$/.test(directory)) return { version: directory, conflict: !!declaredVersion && declaredVersion !== directory };
  return { version: declaredVersion ?? directory, conflict: false };
}
const schemaCache = new Map<string, SchemaInputs>();
export interface SchemaInputs {
  referenceKeys: ReturnType<typeof deriveReferenceKeys>;
  idSpaces: ReturnType<typeof deriveIdSpaces>;
}
export function schemaInputs(directory: string): SchemaInputs {
  const cached = schemaCache.get(directory);
  if (cached) return cached;
  if (!existsSync(path.join(directory, 'metamodel.schema.yaml')) && !existsSync(path.join(directory, 'schema', 'metamodel.schema.yaml'))) {
    throw Error(`Schema root unavailable: ${directory}`);
  }
  const { registry } = loadSchemaRegistry(directory);
  const inputs = { referenceKeys: deriveReferenceKeys(registry), idSpaces: deriveIdSpaces(registry) };
  schemaCache.set(directory, inputs);
  return inputs;
}
export function clearSchemaCache(): void { schemaCache.clear(); }

/** One cache per owning model. Text equality also protects against duplicate save/watch events. */
export class DiagnosticModel {
  readonly parsed = new Map<string, ParsedSource>();
  private membership?: string[];
  update(file: string, text?: string): void {
    if (text === undefined) { this.parsed.delete(file); this.membership = undefined; return; }
    if (this.parsed.get(file)?.text === text) return;
    if (!this.parsed.has(file)) this.membership = undefined;
    this.parsed.set(file, parseSource(text));
  }
  private locate(locator: SourceLocator): DiagnosticLocation | undefined {
    const source = this.parsed.get(locator.relFile);
    if (!source) return undefined;
    const range = sourceRange(source, locator);
    return range ? { file: locator.relFile, range, line: source.lineCounter.linePos(range[0]).line } : undefined;
  }
  evaluate(inputs: SchemaInputs, settings: DiagnosticSettings = DEFAULT_DIAGNOSTIC_SETTINGS): ModelDiagnostic[] {
    this.membership ??= classifyModelFiles([...this.parsed.keys()]).modelFiles;
    const documents = this.membership.map(relFile => ({ relFile, source: this.parsed.get(relFile)! }));
    const consistent = documents.every(document => document.source.valid);
    const findings = resolveModelReferences(documents.filter(document => document.source.valid).map(({ relFile, source }) => ({ relFile, data: source.data })), inputs.referenceKeys, undefined, [], inputs.idSpaces);
    const result: ModelDiagnostic[] = [];
    if (settings.duplicateSeverity !== 'off') {
      for (const duplicate of findings.duplicates) {
        const locations = duplicate.sources.map(source => this.locate(source)).filter((location): location is DiagnosticLocation => !!location)
          .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.range[0] - b.range[0]);
        for (const location of locations) {
          const related = locations.filter(other => other !== location);
          result.push({ ...location, related, code: 'duplicate-id', severity: settings.duplicateSeverity,
            message: `Duplicate ID '${duplicate.id}'; also declared at ${related.map(other => `${other.file}:${other.line}`).join(', ')}.` });
        }
      }
    }
    if (consistent && settings.danglingSeverity !== 'off') {
      for (const missing of findings.missing) {
        const location = this.locate(missing.source);
        if (location) result.push({ ...location, related: [], code: 'dangling-reference', severity: settings.danglingSeverity,
          message: `Reference '${missing.value}' is not declared in this model.` });
      }
    }
    return result;
  }
}

export interface DiagnosticWorkspaceAdapter {
  files(): Promise<Array<{ file: string; eligible: boolean }>>;
  read(file: string): Promise<string>;
  overlays(): Map<string, string>;
  settings(root: string): DiagnosticSettings & { schemaVersion?: string; schemaRoot?: string };
  bundledSchemaRoot: string;
}
export interface DiagnosticPublication { root: string; model: DiagnosticModel; diagnostics: ModelDiagnostic[] }
export class DiagnosticWorkspace {
  private membership?: Array<{ file: string; eligible: boolean }>;
  private readonly disk = new Map<string, string>();
  private readonly models = new Map<string, DiagnosticModel>();
  private revision = 0;
  private computation = 0;
  constructor(private readonly adapter: DiagnosticWorkspaceAdapter) {}
  invalidate(file?: string, membership = false): void {
    this.revision++;
    if (file) this.disk.delete(file); else this.disk.clear();
    if (membership) this.membership = undefined;
  }
  async compute(): Promise<DiagnosticPublication[]> {
    const computation = ++this.computation;
    const revision = this.revision;
    const membership = this.membership ?? await this.adapter.files();
    if (revision === this.revision) this.membership = membership;
    const overlays = this.adapter.overlays();
    const roots = new Set(membership.filter(item => item.eligible).map(item => owningModelRoot(item.file)).filter((root): root is string => !!root));
    const snapshots = new Map<string, Map<string, string>>();
    for (const root of roots) snapshots.set(root, new Map());
    for (const { file } of membership) {
      if (computation !== this.computation || revision !== this.revision) return [];
      const root = owningModelRoot(file);
      const snapshot = root && snapshots.get(root);
      if (!snapshot) continue;
      let text = overlays.get(file) ?? this.disk.get(file);
      if (text === undefined) {
        try {
          text = await this.adapter.read(file);
          if (revision === this.revision) this.disk.set(file, text);
        } catch { text = '['; } // An unreadable member suppresses speculative missing findings.
      }
      snapshot.set(path.relative(root, file).split(path.sep).join('/'), text);
    }
    // Open documents supplement membership, including new unsaved siblings inside a known root.
    for (const [file, text] of overlays) {
      const root = owningModelRoot(file);
      if (root && snapshots.has(root)) snapshots.get(root)!.set(path.relative(root, file).split(path.sep).join('/'), text);
    }
    const publications: DiagnosticPublication[] = [];
    for (const [root, snapshot] of snapshots) {
      if (computation !== this.computation || revision !== this.revision) return [];
      const model = this.models.get(root) ?? new DiagnosticModel();
      this.models.set(root, model);
      for (const file of model.parsed.keys()) if (!snapshot.has(file)) model.update(file, undefined);
      for (const [file, text] of snapshot) {
        if (computation !== this.computation || revision !== this.revision) return [];
        model.update(file, text);
        // Initial directory parsing cooperates with the host event loop between documents.
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      if (computation !== this.computation || revision !== this.revision) return [];
      const settings = this.adapter.settings(root);
      const rootFile = snapshot.has('blueprint.yaml') ? 'blueprint.yaml' : snapshot.has('blueprint.yml') ? 'blueprint.yml' : snapshot.keys().next().value!;
      const rootData = model.parsed.get(rootFile)?.data as { schemaVersion?: string } | undefined;
      const selected = selectSchema(root, rootData?.schemaVersion, settings.schemaVersion);
      const notice = (code: ModelDiagnostic['code'], message: string): ModelDiagnostic => ({
        file: rootFile, range: [0, 0], line: 1, related: [], code, message, severity: 'warning',
      });
      let diagnostics: ModelDiagnostic[];
      try {
        if (!settings.schemaRoot && selected.version !== BUNDLED_SCHEMA_VERSION) throw Error(`Schema ${selected.version} unavailable. Bundled support: ${BUNDLED_SCHEMA_VERSION}. Set archallyBlueprint.diagnostics.schemaRoot to a local schema tree.`);
        diagnostics = model.evaluate(schemaInputs(settings.schemaRoot || this.adapter.bundledSchemaRoot), settings);
      } catch (error) { diagnostics = [notice('schema-unavailable', error instanceof Error ? error.message : String(error))]; }
      if (selected.conflict) diagnostics.push(notice('schema-version-conflict', `Schema declaration ${rootData?.schemaVersion} conflicts with ${path.basename(root)}; diagnostics use ${selected.version}.`));
      publications.push({ root, model, diagnostics });
    }
    for (const root of this.models.keys()) if (!snapshots.has(root)) this.models.delete(root);
    return publications;
  }
}
