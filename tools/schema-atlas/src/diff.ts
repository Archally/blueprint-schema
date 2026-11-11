/**
 * Structural schema diff - classify what changed between two versions.
 *
 * Conservative by default: changes are `add`/`remove` unless a rename
 * is explicitly annotated via a changelog overlay. Semver impact is inferred
 * conservatively (a change that COULD break consumers is `major`). The diff is
 * structural truth; human rationale attaches separately as overlay notes.
 */
import type {
  AtlasModel,
  ChangeEntry,
  DefInfo,
  PropertyInfo,
  Provenance,
  SchemaDiff,
  SchemaFile,
} from './types.js';
import { sourceRef } from './provenance.js';
import type { PolicyReporter } from './policy.js';

export interface RenameAnnotation {
  /** Old (from-version) address: `file` or `file#/$defs/x`. */
  renamedFrom: string;
  /** New (to-version) address. */
  target: string;
  basis: string;
  note?: string;
}

/**
 * Comparison follows in-memory $ref targets for up to MAX_REF_DEPTH links.
 * Unresolved references retain their declared labels for conservative comparison.
 * Rendering uses the declared labels; comparison uses the resolved shapes.
 */
const MAX_REF_DEPTH = 8;

interface EffectiveShape {
  /** Type label after following refs; falls back to the declared label when unresolvable. */
  label: string;
  /** Enum values after following refs, when the resolved target constrains an enum. */
  enumValues?: string[];
  /** False when a ref could not be followed - the caller then treats the comparison as conservative. */
  resolved: boolean;
}

/** Split `../metamodel.schema.yaml#/$defs/x` into its file (relative to `fromRelPath`) and def name. */
function splitRef(ref: string, fromRelPath: string): { relPath: string; defName: string } | undefined {
  const hashIdx = ref.indexOf('#');
  if (hashIdx === -1) return undefined;
  const defIdx = ref.indexOf('#/$defs/');
  if (defIdx === -1) return undefined;
  const defName = ref.slice(defIdx + '#/$defs/'.length);
  const filePart = ref.slice(0, hashIdx);
  if (!filePart) return { relPath: fromRelPath, defName };
  const segments = `${fromRelPath.split('/').slice(0, -1).join('/')}/${filePart}`.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return { relPath: out.join('/'), defName };
}

function findDef(model: AtlasModel, relPath: string, defName: string): DefInfo | undefined {
  return model.files.find((f) => f.relPath === relPath)?.definitions.find((d) => d.name === defName);
}

/**
 * @param model the version the property belongs to
 * @param fromRelPath the file the property is declared in, so relative refs resolve
 */
function effectiveShape(
  model: AtlasModel,
  fromRelPath: string,
  type: { label: string; ref?: string; itemRef?: string },
  declaredEnum: string[] | undefined,
): EffectiveShape {
  // An array whose ITEMS are a ref: resolve the item and rebuild the label, so
  // `array<ref -> model_traits_item>` compares against `array<string>` on its merits.
  if (type.itemRef) {
    const item = effectiveShape(model, fromRelPath, { label: '', ref: type.itemRef }, undefined);
    if (!item.resolved) return { label: type.label, enumValues: declaredEnum, resolved: false };
    return { label: `array<${item.label}>`, enumValues: declaredEnum ?? item.enumValues, resolved: true };
  }

  let ref = type.ref;
  let currentPath = fromRelPath;
  let label = type.label;
  let enumValues = declaredEnum;
  for (let depth = 0; ref && depth < MAX_REF_DEPTH; depth++) {
    const split = splitRef(ref, currentPath);
    if (!split) return { label, enumValues, resolved: false };
    const def = findDef(model, split.relPath, split.defName);
    if (!def) return { label, enumValues, resolved: false };
    label = def.type.label;
    enumValues = def.enumValues ?? enumValues;
    currentPath = split.relPath;
    ref = def.type.ref;
    if (!ref) return { label, enumValues, resolved: true };
  }
  return { label, enumValues, resolved: !ref };
}

interface Container {
  pointer: string;
  properties: Map<string, PropertyInfo>;
}

function containersOf(file: SchemaFile): Map<string, Container> {
  const map = new Map<string, Container>();
  map.set('', { pointer: '', properties: new Map(file.properties.map((p) => [p.name, p])) });
  for (const def of file.definitions) {
    map.set(def.pointer, { pointer: def.pointer, properties: new Map(def.properties.map((p) => [p.name, p])) });
  }
  return map;
}

function defMap(file: SchemaFile): Map<string, DefInfo> {
  return new Map(file.definitions.map((d) => [d.pointer, d]));
}

function setDiff<T>(a: Set<T>, b: Set<T>): { added: T[]; removed: T[] } {
  return {
    added: [...b].filter((x) => !a.has(x)),
    removed: [...a].filter((x) => !b.has(x)),
  };
}

function bothProv(fromV: string, toV: string, file: string, pointer: string): Provenance {
  return { schema: [sourceRef(toV, file, pointer), sourceRef(fromV, file, pointer)] };
}

export function diffModels(
  from: AtlasModel,
  to: AtlasModel,
  renames: RenameAnnotation[],
  policy: PolicyReporter,
): SchemaDiff {
  const changes: ChangeEntry[] = [];
  const renameByOldFile = new Map(renames.map((r) => [r.renamedFrom, r]));
  const renameTargets = new Set(renames.map((r) => r.target));

  const fromFiles = new Map(from.files.map((f) => [f.relPath, f]));
  const toFiles = new Map(to.files.map((f) => [f.relPath, f]));

  // ---- File-level ----
  for (const [rel, ff] of fromFiles) {
    if (toFiles.has(rel)) continue;
    const rename = renameByOldFile.get(rel);
    if (rename && toFiles.has(rename.target)) {
      changes.push({
        kind: 'rename',
        scope: 'file',
        target: `${rel} → ${rename.target}`,
        semver: 'major',
        summary: `Schema file renamed from \`${rel}\` to \`${rename.target}\`.`,
        provenance: { schema: [sourceRef(from.version, rel, ''), sourceRef(to.version, rename.target, '')] },
        note: rename.note,
        renameBasis: rename.basis,
      });
    } else {
      changes.push({
        kind: 'remove',
        scope: 'file',
        target: rel,
        semver: 'major',
        summary: `Schema file \`${rel}\` removed.`,
        provenance: { schema: [sourceRef(from.version, rel, '')] },
      });
    }
    void ff;
  }
  for (const [rel] of toFiles) {
    if (fromFiles.has(rel)) continue;
    if (renameTargets.has(rel)) continue; // already recorded as a rename
    changes.push({
      kind: 'add',
      scope: 'file',
      target: rel,
      semver: 'minor',
      summary: `New schema file \`${rel}\` added.`,
      provenance: { schema: [sourceRef(to.version, rel, '')] },
    });
  }

  // ---- Definition + property level (files present in both) ----
  for (const [rel, toFile] of toFiles) {
    const fromFile = fromFiles.get(rel);
    if (!fromFile) continue;

    // Definitions.
    const fromDefs = defMap(fromFile);
    const toDefs = defMap(toFile);
    const defDelta = setDiff(new Set(fromDefs.keys()), new Set(toDefs.keys()));
    for (const ptr of defDelta.added.sort()) {
      const d = toDefs.get(ptr)!;
      changes.push({
        kind: 'add',
        scope: 'definition',
        target: `${rel}#${ptr}`,
        semver: 'minor',
        summary: `New definition \`${d.name}\` added to \`${rel}\`.`,
        provenance: { schema: [sourceRef(to.version, rel, ptr)] },
      });
    }
    for (const ptr of defDelta.removed.sort()) {
      const d = fromDefs.get(ptr)!;
      changes.push({
        kind: 'remove',
        scope: 'definition',
        target: `${rel}#${ptr}`,
        semver: 'major',
        summary: `Definition \`${d.name}\` removed from \`${rel}\`.`,
        provenance: { schema: [sourceRef(from.version, rel, ptr)] },
      });
    }

    // Properties, per shared container.
    const fromContainers = containersOf(fromFile);
    const toContainers = containersOf(toFile);
    for (const [ptr, toC] of toContainers) {
      const fromC = fromContainers.get(ptr);
      if (!fromC) continue; // container is new/removed - covered by def add/remove
      diffProperties(rel, ptr, fromC, toC, from.version, to.version, changes, from, to);
    }
  }

  // Deterministic ordering.
  const kindRank: Record<string, number> = { remove: 0, rename: 1, 'requiredness-change': 2, deprecate: 3, modify: 4, add: 5 };
  changes.sort(
    (a, b) => (kindRank[a.kind]! - kindRank[b.kind]!) || a.target.localeCompare(b.target),
  );

  const majors = changes.filter((c) => c.semver === 'major').length;
  if (majors > 0) {
    policy.warn('diff-breaking', `${majors} breaking (major) change(s) detected from ${from.version} to ${to.version}.`);
  }

  return { from: from.version, to: to.version, changes };
}

function diffProperties(
  rel: string,
  containerPtr: string,
  fromC: Container,
  toC: Container,
  fromV: string,
  toV: string,
  changes: ChangeEntry[],
  fromModel: AtlasModel,
  toModel: AtlasModel,
): void {
  const label = (name: string) => `${rel}#${containerPtr}/properties/${name}`;
  const delta = setDiff(new Set(fromC.properties.keys()), new Set(toC.properties.keys()));

  for (const name of delta.added.sort()) {
    const p = toC.properties.get(name)!;
    changes.push({
      kind: 'add',
      scope: 'property',
      target: label(name),
      semver: p.required ? 'major' : 'minor',
      summary: `Property \`${name}\` added${p.required ? ' (required - breaking)' : ' (optional)'}.`,
      provenance: { schema: [sourceRef(toV, rel, p.pointer)] },
    });
  }
  for (const name of delta.removed.sort()) {
    const p = fromC.properties.get(name)!;
    changes.push({
      kind: 'remove',
      scope: 'property',
      target: label(name),
      semver: 'major',
      summary: `Property \`${name}\` removed.`,
      provenance: { schema: [sourceRef(fromV, rel, p.pointer)] },
    });
  }

  for (const name of [...toC.properties.keys()].sort()) {
    const tp = toC.properties.get(name)!;
    const fp = fromC.properties.get(name);
    if (!fp) continue;

    if (fp.required !== tp.required) {
      const tightened = !fp.required && tp.required;
      changes.push({
        kind: 'requiredness-change',
        scope: 'property',
        target: label(name),
        semver: tightened ? 'major' : 'minor',
        summary: `Property \`${name}\` became ${tp.required ? 'required (breaking)' : 'optional'}.`,
        provenance: bothProv(fromV, toV, rel, tp.pointer),
      });
    }

    if (!fp.deprecated && tp.deprecated) {
      changes.push({
        kind: 'deprecate',
        scope: 'property',
        target: label(name),
        semver: 'minor',
        summary: `Property \`${name}\` marked deprecated.`,
        provenance: bothProv(fromV, toV, rel, tp.pointer),
      });
    }

    // Compare resolved shapes while retaining declared labels for rendering.
    const fromShape = effectiveShape(fromModel, rel, fp.type, fp.enumValues);
    const toShape = effectiveShape(toModel, rel, tp.type, tp.enumValues);

    if (fp.type.label !== tp.type.label && fromShape.label !== toShape.label) {
      changes.push({
        kind: 'modify',
        scope: 'property',
        target: label(name),
        semver: 'major',
        summary: `Property \`${name}\` type changed \`${fp.type.label}\` → \`${tp.type.label}\`.`,
        provenance: bothProv(fromV, toV, rel, tp.pointer),
      });
    }

    // Compare resolved enum values. If resolution fails on either side,
    // compare only enums declared inline on both sides.
    const bothResolved = fromShape.resolved && toShape.resolved;
    const enumChange = bothResolved
      ? diffEnum(fromShape.enumValues, toShape.enumValues)
      : fp.enumValues && tp.enumValues
        ? diffEnum(fp.enumValues, tp.enumValues)
        : undefined;
    if (enumChange) {
      changes.push({
        kind: 'modify',
        scope: 'property',
        target: label(name),
        semver: enumChange.semver,
        summary: `Property \`${name}\` enum ${enumChange.summary}.`,
        provenance: bothProv(fromV, toV, rel, tp.pointer),
      });
    }
  }
}

function diffEnum(
  fromE: string[] | undefined,
  toE: string[] | undefined,
): { semver: 'major' | 'minor'; summary: string } | undefined {
  if (!fromE && !toE) return undefined;
  const a = new Set(fromE ?? []);
  const b = new Set(toE ?? []);
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  if (added.length === 0 && removed.length === 0) return undefined;
  if (removed.length > 0) {
    return { semver: 'major', summary: `values removed: ${removed.map((v) => `\`${v}\``).join(', ')}` };
  }
  return { semver: 'minor', summary: `values added: ${added.map((v) => `\`${v}\``).join(', ')}` };
}
