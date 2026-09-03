import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// v2.8 makes the typed-id conventions binding. "Free-string id" sounds like one defect and is two,
// with different shapes and different risk:
//
//   MINT    `context.id` (BC###) and `service.id` (SVC###) are already pattern-typed when present,
//           but OPTIONAL, so an entity can simply have none. Nothing references an id that does not
//           exist, so writing one is additive - the shape module `004` already uses for `party`.
//
//   RETYPE  `resource.id` (IR###) and `deployment_scope.id` (DSC###) are declared `type: string`
//           and only WARNed about. The id EXISTS and is referenced, so changing it means rewriting
//           every reference to it in the same pass or the model stops resolving.
//
// A model may carry either defect, both, or neither, and the two are independent: a model authored
// against 2.7 from the start usually has typed resource ids and no context ids at all, because one
// convention was enforced by a pattern and the other only by habit. `ENV###` and `BND###` appear in
// neither list - their ids are pattern-typed and required already, so there is nothing to lift.
//
// `party.id` is NOT minted here. Module `004` mints it, including the org-part adoption rule, and
// runs before this one in the same chain. A party still missing an id is REPORTED, so a chain that
// skipped `004` is visible rather than silently half-migrated.
//
// TEXT, NOT YAML. Inherited from `004` and load-bearing for the same reason: this tool has no
// runtime dependencies and its modules edit text so comments, key order and line endings survive.
// A parse/stringify round-trip would reformat every file it touches and bury the change.
//
// WHAT IT REFUSES TO GUESS. A reference is rewritten only where the field NAME is one the schema
// declares as an `IR###`/`DSC###` ref, and the three ambiguous names (`target`, `parent`, `ref`)
// only inside infrastructure documents, where the schema puts them. Every OTHER occurrence of a
// retyped id is reported and left alone: a value that merely looks like an id is not one, and a
// silent wrong rewrite is the failure this whole tool exists to avoid.

const ARCH_FILE = /^(arch\.(yaml|yml)|[^/\\]+[.-]arch\.(yaml|yml))$/i;
const INFRA_FILE = /^(infrastructure\.(yaml|yml)|[^/\\]+[.-]infrastructure\.(yaml|yml))$/i;

const TARGET_SCHEMA_VERSION = '2.8.0';
const SOURCE_DIRECTORY = 'v2.7';
const TARGET_DIRECTORY = 'v2.8';

/** Families this module mints an id for, in the arch nesting `parties -> contexts -> services`. */
const BC = /^([a-z][a-z0-9-]*\.)?BC\d{3,}$/;
const SVC = /^([a-z][a-z0-9-]*\.)?SVC\d{3,}$/;
/** Families this module retypes, both declared at the root of an infrastructure document. */
const IR = /^([a-z][a-z0-9-]*\.)?IR\d{3,}$/;
const DSC = /^([a-z][a-z0-9-]*\.)?DSC\d{3,}$/;
const PRT = /^([a-z][a-z0-9-]*\.)?PRT\d{3,}$/;

/**
 * Field names that hold a reference to the retyped families, derived from the v2.8 schema tree by
 * walking every `$ref` to `infra_resource_ref` / `deployment_scope_ref` and recording the property
 * that carries it.
 *
 * `anywhere` names are unambiguous - a `resource_ref` is an IR ref in every document that has one.
 * `infraOnly` names are common words the schema uses for these refs only inside an infrastructure
 * document (`relations[].target`, `deployment_scopes[].parent`, `target_scope.ref`); applying them
 * everywhere would rewrite an unrelated `target:` that happened to match.
 */
const IR_REF_KEYS = { anywhere: ['resource_ref', 'resource_refs', 'infrastructure'], infraOnly: ['target'] };
const DSC_REF_KEYS = { anywhere: [] as string[], infraOnly: ['scope_ref', 'parent', 'ref'] };

interface SourceLine {
  text: string;
  /** Offset of the line's first character. */
  start: number;
  /** The line's own terminator, so an edit keeps the file's CRLF/LF mix intact. */
  eol: string;
}

/** One `- ` entry of a block sequence, with the keys declared at its own key column. */
interface SequenceEntry {
  lineIndex: number;
  dashIndent: string;
  /** Whitespace between the `-` and the first key, preserved so rewritten keys stay aligned. */
  dashSpacing: string;
  /** Column at which the entry's own keys start. */
  keyColumn: number;
  /** Text of the first key, which sits on the `- ` line itself. */
  firstKeyText: string;
  /** Value text of each scalar key at this entry's key column. */
  values: Map<string, string>;
  /** Line index of each key at this entry's key column whose value is empty, so it opens a block. */
  blocks: Map<string, number>;
}

function scanLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let position = 0;
  for (;;) {
    const newline = content.indexOf('\n', position);
    if (newline === -1) {
      lines.push({ text: content.slice(position), start: position, eol: '' });
      return lines;
    }
    const carriage = newline > position && content[newline - 1] === '\r';
    lines.push({
      text: content.slice(position, carriage ? newline - 1 : newline),
      start: position,
      eol: carriage ? '\r\n' : '\n',
    });
    position = newline + 1;
  }
}

function walkYamlFiles(directory: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walkYamlFiles(fullPath));
    else if (/\.(yaml|yml)$/i.test(entry.name)) results.push(fullPath);
  }
  return results;
}

const indentOf = (text: string): number => text.length - text.replace(/^[ \t]*/, '').length;
const isBlank = (text: string): boolean => text.trim() === '' || /^[ \t]*#/.test(text);

function unquote(value: string): string {
  const trimmed = value.replace(/[ \t]+#.*$/, '').trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2]! : trimmed;
}

/**
 * The block sequence opened by the `key:` at `blockLineIndex`, or null when there is none.
 *
 * Null covers three cases the caller must not confuse with "no entries": the key carries a flow
 * sequence, the key carries a scalar, or the block is empty. Flow style is reported by the caller
 * rather than rewritten, which is `004`'s rule and holds for the same reason - a flow rewrite is a
 * reformat, and a reformat buries the change it was asked to make.
 */
function readSequence(lines: SourceLine[], blockLineIndex: number): SequenceEntry[] | null {
  const blockIndent = indentOf(lines[blockLineIndex]!.text);
  let entryIndent: number | null = null;
  const entries: SequenceEntry[] = [];
  let current: SequenceEntry | null = null;

  for (let index = blockLineIndex + 1; index < lines.length; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text)) continue;
    const indent = indentOf(text);
    const dashMatch = /^([ \t]*)-([ \t]+)(\S.*)$/.exec(text);

    if (entryIndent === null) {
      // The sequence's own indent is set by its first entry. Anything else means there is no block
      // sequence here at all.
      if (!dashMatch || indent < blockIndent) return null;
      entryIndent = indent;
    } else if (indent < entryIndent) {
      break; // a shallower line ends the sequence
    }

    if (dashMatch && indent === entryIndent) {
      if (dashMatch[3]!.startsWith('{')) return null; // flow mapping entry
      current = {
        lineIndex: index,
        dashIndent: dashMatch[1]!,
        dashSpacing: dashMatch[2]!,
        keyColumn: indent + 1 + dashMatch[2]!.length,
        firstKeyText: dashMatch[3]!,
        values: new Map(),
        blocks: new Map(),
      };
      entries.push(current);
      readKey(current, dashMatch[3]!, index);
      continue;
    }
    // A key of the current entry sits exactly at its key column; anything deeper is nested data.
    if (current && indent === current.keyColumn) readKey(current, text.trimStart(), index);
  }

  return entries;
}

function readKey(entry: SequenceEntry, keyText: string, lineIndex: number): void {
  const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(keyText);
  if (!match) return;
  const [, key, rest] = match as unknown as [string, string, string];
  const value = rest.replace(/[ \t]+#.*$/, '').trim();
  if (value === '' || value.startsWith('#')) entry.blocks.set(key, lineIndex);
  else entry.values.set(key, value);
}

/** The line index of a root-level `key:` that opens a block, or -1. */
function findRootBlock(lines: SourceLine[], key: string): number {
  return lines.findIndex((line) => new RegExp(`^${key}:[ \\t]*(#.*)?$`).test(line.text));
}

/**
 * Gap-unaware `max + 1` within a namespace, mirroring `allocateNextId` in the shared `next-id` unit
 * that the vertical CLIs and the MCP use: the namespace is part of the counter, the width is the
 * widest number already in use (minimum 3), and a trailing member letter (`SVC009a`) occupies its
 * family's number so it is counted.
 *
 * Restated rather than imported, for `004`'s reason: this tool has no runtime dependencies, so an
 * id it mints has to be computed here. The rule is the one every other allocator in the toolchain
 * applies, so an id this produces is the id the CLI would have offered for the same model.
 */
function makeAllocator(used: Set<string>, prefix: string, namespace: string | null): () => string {
  const escaped = namespace ? `${namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.` : '';
  const pattern = new RegExp(`^${escaped}${prefix}(\\d+)[a-z]?$`);
  let highest = 0;
  let width = 0;
  for (const id of used) {
    const match = pattern.exec(id);
    if (!match) continue;
    highest = Math.max(highest, Number(match[1]));
    width = Math.max(width, match[1]!.length);
  }
  const pad = Math.max(3, width);
  return () => {
    highest += 1;
    const core = `${prefix}${String(highest).padStart(pad, '0')}`;
    return namespace ? `${namespace}.${core}` : core;
  };
}

/**
 * The scope prefix a minted id should carry: the one every existing id of this family already uses,
 * or none.
 *
 * Unanimity is the whole rule. A model whose `BC###` ids all read `shop.BC00N` is stating a
 * convention; one that mixes `shop.BC001` with `warehouse.BC001` is not stating a single one, and a
 * model with no id of the family yet has stated nothing. In both of those cases the id is minted
 * bare, because picking a scope from a folder name or a party name would be inference - and
 * inference belongs nowhere near a file rewrite.
 */
function unanimousNamespace(used: Set<string>, prefix: string): string | null {
  const pattern = new RegExp(`^(?:([A-Za-z0-9-]+)\\.)?${prefix}\\d+[a-z]?$`);
  const scopes = new Set<string>();
  for (const id of used) {
    const match = pattern.exec(id);
    if (match) scopes.add(match[1] ?? '');
  }
  if (scopes.size !== 1) return null;
  const only = [...scopes][0]!;
  return only === '' ? null : only;
}

interface MintSite {
  relativePath: string;
  absolutePath: string;
  entry: SequenceEntry;
  id: string;
  kind: 'context' | 'service';
  name: string;
}

interface RetypeSite {
  relativePath: string;
  absolutePath: string;
  entry: SequenceEntry;
  oldId: string;
  newId: string;
  kind: 'resource' | 'deployment scope';
}

interface RefSite {
  relativePath: string;
  absolutePath: string;
  lineIndex: number;
  oldId: string;
  newId: string;
  key: string;
}

interface VersionSite {
  relativePath: string;
  absolutePath: string;
  lineIndex: number;
  from: string;
}

interface Analysis {
  mints: MintSite[];
  retypes: RetypeSite[];
  refs: RefSite[];
  versions: VersionSite[];
  directoryRename: PlannedChange | null;
  warnings: string[];
  /** Files whose lines were scanned, keyed by absolute path, so `apply` does not re-read them. */
  lines: Map<string, SourceLine[]>;
}

const ID_LIKE = /^(?:[A-Za-z0-9-]+\.)?[A-Z]{2,6}\d+[a-z]?$/;

/** Every id-like token in the file, so a freshly minted id can never collide with a reference. */
function harvestIds(content: string, into: Set<string>): void {
  for (const match of content.matchAll(/(?<![A-Za-z0-9_.-])((?:[A-Za-z0-9-]+\.)?[A-Z]{2,6}\d+[a-z]?)(?![A-Za-z0-9_-])/g)) {
    if (ID_LIKE.test(match[1]!)) into.add(match[1]!);
  }
}

function analyse(absoluteDir: string): Analysis {
  const warnings: string[] = [];
  const lines = new Map<string, SourceLine[]>();
  const usedIds = new Set<string>();

  const archFiles: { relativePath: string; absolutePath: string }[] = [];
  const infraFiles: { relativePath: string; absolutePath: string }[] = [];
  const allFiles: { relativePath: string; absolutePath: string; isInfra: boolean }[] = [];

  for (const absolutePath of walkYamlFiles(absoluteDir)) {
    const relativePath = path.relative(absoluteDir, absolutePath).replace(/\\/g, '/');
    const content = fs.readFileSync(absolutePath, 'utf8');
    harvestIds(content, usedIds);
    lines.set(absolutePath, scanLines(content));

    const fileName = path.basename(relativePath);
    const isInfra = INFRA_FILE.test(fileName);
    if (ARCH_FILE.test(fileName)) archFiles.push({ relativePath, absolutePath });
    if (isInfra) infraFiles.push({ relativePath, absolutePath });
    allFiles.push({ relativePath, absolutePath, isInfra });
  }

  const mints = collectArchMints(archFiles, lines, usedIds, warnings);
  const { retypes, idMap } = collectInfraRetypes(infraFiles, lines, usedIds, warnings);
  const refs = collectRefSites(allFiles, lines, idMap, warnings);
  const versions = collectVersionSites(allFiles, lines);

  const directoryRename =
    path.basename(absoluteDir) === SOURCE_DIRECTORY
      ? {
          type: 'rename-directory' as const,
          path: SOURCE_DIRECTORY,
          detail: `${SOURCE_DIRECTORY}/ -> ${TARGET_DIRECTORY}/ (version bump)`,
        }
      : null;

  return { mints, retypes, refs, versions, directoryRename, warnings, lines };
}

/**
 * Contexts and services that carry no id, with the id each will get.
 *
 * Two passes over the arch files, not one: every id must be allocated after every existing id in
 * the whole model has been seen, and the same context declared in two slice files must receive one
 * id rather than two. Identity is the scope-qualified NAME, which is what the arch schema already
 * requires on every occurrence.
 */
function collectArchMints(
  archFiles: { relativePath: string; absolutePath: string }[],
  lines: Map<string, SourceLine[]>,
  usedIds: Set<string>,
  warnings: string[],
): MintSite[] {
  const contextNamespace = unanimousNamespace(usedIds, 'BC');
  const serviceNamespace = unanimousNamespace(usedIds, 'SVC');
  const allocateContext = makeAllocator(usedIds, 'BC', contextNamespace);
  const allocateService = makeAllocator(usedIds, 'SVC', serviceNamespace);
  const contextIds = new Map<string, string>();
  const serviceIds = new Map<string, string>();
  const sites: MintSite[] = [];

  for (const file of archFiles) {
    const fileLines = lines.get(file.absolutePath)!;
    const partiesLine = findRootBlock(fileLines, 'parties');
    if (partiesLine === -1) {
      if (fileLines.some((line) => /^parties:[ \t]*\S/.test(line.text))) {
        warnings.push(`${file.relativePath}: flow-style \`parties:\` - add \`id:\` by hand`);
      }
      continue;
    }
    const parties = readSequence(fileLines, partiesLine);
    if (!parties) {
      warnings.push(`${file.relativePath}: \`parties:\` is not a block sequence - add \`id:\` by hand`);
      continue;
    }

    for (const party of parties) {
      const partyId = party.values.get('id');
      // `004` mints PRT### and adopts the org part's id. Duplicating that rule here would be a
      // second implementation of one transform; reporting it keeps a skipped chain visible.
      if (!partyId) {
        warnings.push(
          `${file.relativePath}: party ${describe(party)} has no PRT### - run schema-update 004 first (v2.8 requires it)`,
        );
      } else if (!PRT.test(unquote(partyId))) {
        warnings.push(`${file.relativePath}: party id "${unquote(partyId)}" does not match PRT###`);
      }

      const contextsLine = party.blocks.get('contexts');
      if (contextsLine === undefined) continue;
      const contexts = readSequence(fileLines, contextsLine);
      if (!contexts) continue; // `contexts: []` is the schema's own way of saying "none here"

      for (const context of contexts) {
        const existing = context.values.get('id');
        const name = context.values.get('name');
        if (existing) {
          if (!BC.test(unquote(existing))) {
            warnings.push(`${file.relativePath}: context id "${unquote(existing)}" does not match BC###`);
          }
        } else if (!name) {
          warnings.push(`${file.relativePath}: context entry without a name - skipped`);
        } else {
          const key = unquote(name);
          let id = contextIds.get(key);
          if (!id) {
            id = allocateContext();
            contextIds.set(key, id);
          }
          sites.push({ ...file, entry: context, id, kind: 'context', name: key });
        }

        const servicesLine = context.blocks.get('services');
        if (servicesLine === undefined) continue;
        const services = readSequence(fileLines, servicesLine);
        if (!services) continue;

        for (const service of services) {
          const serviceId = service.values.get('id');
          const serviceName = service.values.get('name');
          if (serviceId) {
            if (!SVC.test(unquote(serviceId))) {
              warnings.push(`${file.relativePath}: service id "${unquote(serviceId)}" does not match SVC###`);
            }
            continue;
          }
          if (!serviceName) {
            warnings.push(`${file.relativePath}: service entry without a name - skipped`);
            continue;
          }
          // A service name is unique within its context, not within the model, so the identity key
          // carries the owning context: two contexts may each declare an "API".
          const contextKey = unquote(context.values.get('id') ?? context.values.get('name') ?? '');
          const key = `${contextKey} ${unquote(serviceName)}`;
          let id = serviceIds.get(key);
          if (!id) {
            id = allocateService();
            serviceIds.set(key, id);
          }
          sites.push({ ...file, entry: service, id, kind: 'service', name: unquote(serviceName) });
        }
      }
    }
  }

  return sites;
}

const describe = (entry: SequenceEntry): string => {
  const name = entry.values.get('name');
  return name ? `"${unquote(name)}"` : `at line ${entry.lineIndex + 1}`;
};

/** Free-string resource and deployment-scope ids, with the typed id each will become. */
function collectInfraRetypes(
  infraFiles: { relativePath: string; absolutePath: string }[],
  lines: Map<string, SourceLine[]>,
  usedIds: Set<string>,
  warnings: string[],
): { retypes: RetypeSite[]; idMap: Map<string, string> } {
  const families = [
    { key: 'resources', prefix: 'IR', pattern: IR, kind: 'resource' as const },
    { key: 'deployment_scopes', prefix: 'DSC', pattern: DSC, kind: 'deployment scope' as const },
  ];
  const retypes: RetypeSite[] = [];
  const idMap = new Map<string, string>();

  for (const family of families) {
    const namespace = unanimousNamespace(usedIds, family.prefix);
    const allocate = makeAllocator(usedIds, family.prefix, namespace);
    for (const file of infraFiles) {
      const fileLines = lines.get(file.absolutePath)!;
      const blockLine = findRootBlock(fileLines, family.key);
      if (blockLine === -1) continue;
      const entries = readSequence(fileLines, blockLine);
      if (!entries) {
        warnings.push(`${file.relativePath}: \`${family.key}:\` is not a block sequence - retype by hand`);
        continue;
      }
      for (const entry of entries) {
        const raw = entry.values.get('id');
        if (!raw) continue;
        const oldId = unquote(raw);
        if (family.pattern.test(oldId)) continue;
        // One free-string id may be declared once and referenced from many files; it keeps one
        // typed id, which is also what makes a second run of this module plan nothing.
        let newId = idMap.get(oldId);
        if (!newId) {
          newId = allocate();
          idMap.set(oldId, newId);
        }
        retypes.push({ ...file, entry, oldId, newId, kind: family.kind });
      }
    }
  }

  return { retypes, idMap };
}

/**
 * Every reference to a retyped id, and a warning for every occurrence that is NOT one.
 *
 * The rewrite is keyed on the field NAME the schema declares for these refs. The alternative -
 * replacing the id text wherever it appears - would rewrite a `name:` or a slice label that happens
 * to read the same, and a wrong rewrite here looks exactly like a right one. So anything outside a
 * known ref field is reported instead, and `--dry-run` shows the caller what to check by hand.
 */
function collectRefSites(
  allFiles: { relativePath: string; absolutePath: string; isInfra: boolean }[],
  lines: Map<string, SourceLine[]>,
  idMap: Map<string, string>,
  warnings: string[],
): RefSite[] {
  if (idMap.size === 0) return [];
  const sites: RefSite[] = [];
  const anywhere = new Set([...IR_REF_KEYS.anywhere, ...DSC_REF_KEYS.anywhere]);
  const infraOnly = new Set([...IR_REF_KEYS.infraOnly, ...DSC_REF_KEYS.infraOnly]);

  for (const file of allFiles) {
    const refKeys = new Set(file.isInfra ? [...anywhere, ...infraOnly] : anywhere);
    const fileLines = lines.get(file.absolutePath)!;
    // Stack of block keys still open at this indent, so a `- item` knows which key owns it.
    const openKeys: { indent: number; key: string }[] = [];
    const touched = new Set<number>();

    for (let index = 0; index < fileLines.length; index += 1) {
      const { text } = fileLines[index]!;
      if (isBlank(text)) continue;
      // A key's column, not the line's indent: on a `- key: value` line the key starts after the
      // dash, and that column is what a nested block is measured against. Popping on the raw indent
      // would leave a sequence entry's keys open under the entry that follows it.
      const body = text.replace(/^[ \t]*(-[ \t]+)?/, '');
      const dashOffset = text.length - body.length;
      while (openKeys.length > 0 && openKeys[openKeys.length - 1]!.indent >= dashOffset) openKeys.pop();
      const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(body);

      if (keyMatch) {
        const [, key, rest] = keyMatch as unknown as [string, string, string];
        const value = rest.replace(/[ \t]+#.*$/, '').trim();
        if (value === '') {
          openKeys.push({ indent: dashOffset, key });
          continue;
        }
        if (!refKeys.has(key)) continue;
        for (const [oldId, newId] of idMap) {
          if (matchesScalarOrFlow(value, oldId)) {
            sites.push({ ...file, lineIndex: index, oldId, newId, key });
            touched.add(index);
          }
        }
        continue;
      }

      // A bare sequence item belongs to the nearest key open above it.
      const itemMatch = /^-[ \t]+(\S.*)$/.exec(text.trimStart());
      if (!itemMatch) continue;
      const owner = openKeys[openKeys.length - 1];
      if (!owner || !refKeys.has(owner.key)) continue;
      const value = itemMatch[1]!.replace(/[ \t]+#.*$/, '').trim();
      for (const [oldId, newId] of idMap) {
        if (unquote(value) === oldId) {
          sites.push({ ...file, lineIndex: index, oldId, newId, key: owner.key });
          touched.add(index);
        }
      }
    }

    reportUntouched(file, fileLines, idMap, touched, warnings);
  }

  return sites;
}

/** `key: value`, or a flow sequence `key: [a, b]` holding the id as one of its items. */
function matchesScalarOrFlow(value: string, oldId: string): boolean {
  if (unquote(value) === oldId) return true;
  if (!value.startsWith('[') || !value.endsWith(']')) return false;
  return value
    .slice(1, -1)
    .split(',')
    .some((item) => unquote(item) === oldId);
}

/**
 * Lines whose WHOLE value is a retyped id but whose field is not one this module rewrites.
 *
 * The test is on the entire scalar, not on the id appearing somewhere in the line. A free-string id
 * reads like ordinary prose - `catalog-api` occurs in descriptions, code paths and slice labels -
 * and a warning per prose mention would bury the handful that are actually references under a flood
 * that nobody reads. A value that IS the id, under a field this module does not know, is the shape
 * worth a human's attention.
 */
function reportUntouched(
  file: { relativePath: string },
  fileLines: SourceLine[],
  idMap: Map<string, string>,
  touched: Set<number>,
  warnings: string[],
): void {
  for (let index = 0; index < fileLines.length; index += 1) {
    if (touched.has(index)) continue;
    const { text } = fileLines[index]!;
    if (isBlank(text)) continue;
    const body = text.replace(/^[ \t]*(-[ \t]+)?/, '');
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(body);
    // The declaration itself is rewritten by the retype pass, not by the ref pass.
    if (keyMatch && keyMatch[1] === 'id') continue;
    const value = keyMatch ? keyMatch[2]! : /^-[ \t]+(\S.*)$/.exec(text.trimStart())?.[1] ?? '';
    const scalar = unquote(value.replace(/[ \t]+#.*$/, ''));
    if (!idMap.has(scalar)) continue;
    const where = keyMatch ? `\`${keyMatch[1]}\`` : 'a list item';
    warnings.push(
      `${file.relativePath}:${index + 1}: ${where} is "${scalar}", which is not a known reference field - left alone, check by hand`,
    );
  }
}

function collectVersionSites(
  allFiles: { relativePath: string; absolutePath: string }[],
  lines: Map<string, SourceLine[]>,
): VersionSite[] {
  const sites: VersionSite[] = [];
  for (const file of allFiles) {
    const fileLines = lines.get(file.absolutePath)!;
    for (let index = 0; index < fileLines.length; index += 1) {
      const match = /^schemaVersion:[ \t]*["']?(\d+\.\d+\.\d+)["']?[ \t]*(#.*)?$/.exec(fileLines[index]!.text);
      if (match && match[1] !== TARGET_SCHEMA_VERSION) sites.push({ ...file, lineIndex: index, from: match[1]! });
    }
  }
  return sites;
}

function buildPlan(blueprintDir: string): UpdatePlan {
  const absoluteDir = path.resolve(blueprintDir);
  const base = { sourceVersion: '2.7', targetVersion: '2.8', description: update.description };

  if (!fs.existsSync(absoluteDir)) {
    return { ...base, changes: [], warnings: [`Directory not found: ${absoluteDir}`] };
  }

  const analysis = analyse(absoluteDir);
  const changes: PlannedChange[] = [];

  for (const site of analysis.mints) {
    changes.push({
      type: 'edit-yaml',
      path: site.relativePath,
      detail: `${site.kind} "${site.name}" -> id: ${site.id}`,
    });
  }
  for (const site of analysis.retypes) {
    changes.push({
      type: 'edit-yaml',
      path: site.relativePath,
      detail: `${site.kind} id "${site.oldId}" -> ${site.newId}`,
    });
  }
  for (const site of analysis.refs) {
    changes.push({
      type: 'edit-yaml',
      path: site.relativePath,
      detail: `line ${site.lineIndex + 1}: \`${site.key}\` "${site.oldId}" -> ${site.newId}`,
    });
  }
  for (const site of analysis.versions) {
    changes.push({
      type: 'edit-yaml',
      path: site.relativePath,
      detail: `schemaVersion ${site.from} -> ${TARGET_SCHEMA_VERSION}`,
    });
  }
  if (analysis.directoryRename) changes.push(analysis.directoryRename);

  const warnings = [...analysis.warnings];
  if (changes.length === 0) {
    warnings.push('Every typed id is already present and typed, and the version already reads 2.8.0 - nothing to do.');
  }

  return { ...base, changes, warnings };
}

function applyPlan(blueprintDir: string): UpdateResult {
  const absoluteDir = path.resolve(blueprintDir);
  const plan = buildPlan(blueprintDir);
  if (plan.changes.length === 0) return { ...plan, applied: false, errors: [] };

  const errors: string[] = [];
  const analysis = analyse(absoluteDir);

  // Edits are collected per file and per LINE, then spliced in descending offset order so each
  // splice leaves earlier offsets valid.
  //
  // Per line rather than per edit, because one line can carry several: `resource_refs: [a, b]` is
  // two references, and two independent renders reading the ORIGINAL text would each produce a line
  // holding its own rewrite and none of the other's - the second overwriting the first, silently,
  // and only when a line happens to hold two ids. A render therefore takes the text as it stands.
  type Render = (text: string, line: SourceLine) => string;
  const edits = new Map<string, Map<number, Render[]>>();
  const queue = (absolutePath: string, lineIndex: number, render: Render): void => {
    if (!edits.has(absolutePath)) edits.set(absolutePath, new Map());
    const byLine = edits.get(absolutePath)!;
    if (!byLine.has(lineIndex)) byLine.set(lineIndex, []);
    byLine.get(lineIndex)!.push(render);
  };

  for (const site of analysis.mints) {
    queue(site.absolutePath, site.entry.lineIndex, (_text, line) => {
      // The id becomes the entry's first key, so it carries the `- `; the displaced key moves to its
      // own line at the SAME column, or the mapping's keys stop aligning and the YAML breaks.
      const { dashIndent, dashSpacing, keyColumn, firstKeyText } = site.entry;
      return `${dashIndent}-${dashSpacing}id: ${site.id}${line.eol}${' '.repeat(keyColumn)}${firstKeyText}`;
    });
  }
  for (const site of analysis.retypes) {
    queue(site.absolutePath, findIdLine(analysis, site), (text) => replaceIdValue(text, site.newId));
  }
  for (const site of analysis.refs) {
    queue(site.absolutePath, site.lineIndex, (text) => replaceToken(text, site.oldId, site.newId));
  }
  for (const site of analysis.versions) {
    queue(site.absolutePath, site.lineIndex, (text) =>
      text.replace(
        /^(schemaVersion:[ \t]*["']?)(\d+\.\d+\.\d+)(["']?)/,
        (_match, lead: string, _from: string, close: string) => `${lead}${TARGET_SCHEMA_VERSION}${close}`,
      ),
    );
  }

  for (const [absolutePath, byLine] of edits) {
    const fileLines = analysis.lines.get(absolutePath)!;
    try {
      let content = fs.readFileSync(absolutePath, 'utf8');
      for (const lineIndex of [...byLine.keys()].sort((a, b) => b - a)) {
        const line = fileLines[lineIndex]!;
        let text = line.text;
        for (const render of byLine.get(lineIndex)!) text = render(text, line);
        content = content.slice(0, line.start) + text + content.slice(line.start + line.text.length);
      }
      fs.writeFileSync(absolutePath, content, 'utf8');
    } catch (error) {
      errors.push(`Failed to edit ${path.relative(absoluteDir, absolutePath)}: ${(error as Error).message}`);
    }
  }

  // The directory rename runs last, so every edit above addresses a path that still exists.
  if (analysis.directoryRename) {
    try {
      fs.renameSync(absoluteDir, path.join(path.dirname(absoluteDir), TARGET_DIRECTORY));
    } catch (error) {
      errors.push(`Failed to rename directory: ${(error as Error).message}`);
    }
  }

  return { ...plan, applied: errors.length === 0, errors };
}

/**
 * The line carrying a retyped entry's `id:`, which is the entry's own `- ` line when `id` is its
 * first key and a later line otherwise.
 */
function findIdLine(analysis: Analysis, site: RetypeSite): number {
  const fileLines = analysis.lines.get(site.absolutePath)!;
  const { entry } = site;
  if (/^id:/.test(entry.firstKeyText)) return entry.lineIndex;
  for (let index = entry.lineIndex + 1; index < fileLines.length; index += 1) {
    const { text } = fileLines[index]!;
    if (isBlank(text)) continue;
    const indent = indentOf(text);
    if (indent < entry.keyColumn) break;
    if (indent === entry.keyColumn && /^id:/.test(text.trimStart())) return index;
  }
  return entry.lineIndex;
}

/**
 * Both replacements below take a FUNCTION, never a string. A `$` in a replacement string is read by
 * `String.replace` as a group reference, so an id containing one would splice the surrounding match
 * back into the file - silently, and only for the ids that happen to contain it.
 */
function replaceIdValue(text: string, newId: string): string {
  return text.replace(
    /^([ \t]*(?:-[ \t]+)?id:[ \t]*)(["']?)([^"'#]*?)(\2)([ \t]*(?:#.*)?)$/,
    (_match, lead: string, _open: string, _value: string, _close: string, trail: string) => `${lead}${newId}${trail}`,
  );
}

function replaceToken(text: string, oldId: string, newId: string): string {
  const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(
    new RegExp(`(?<![A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_-])`, 'g'),
    () => newId,
  );
}

export const update: SchemaUpdate = {
  sourceVersion: '2.7',
  targetVersion: '2.8',
  description:
    'v2.8 typed ids: mint BC###/SVC### for contexts and services that carry none, retype free-string IR###/DSC### ids and every reference to them, bump schemaVersion to 2.8.0 and move the model to v2.8/',
  plan: buildPlan,
  apply: applyPlan,
};
