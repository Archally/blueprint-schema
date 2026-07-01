/**
 * Schema introspection — versioned JSON Schema → normalized Atlas IR (Step 02).
 *
 * Reads schema truth only; never reinterprets it (DEC-ATL-01). Preserves layer,
 * slice, and nesting boundaries rather than flattening them (DEC-ATL-14). Every
 * produced element carries a source-true address (DEC-ATL-13) for provenance.
 */
import path from 'node:path';
import type {
  AtlasModel,
  DefInfo,
  EntityType,
  FileRelation,
  Plane,
  PlaneId,
  PropertyInfo,
  SchemaFile,
  TypeInfo,
} from './types.js';
import { loadSchemaVersion, planeOf, type LoadedSchema } from './schema-io.js';
import { fileSlug, sourceRef } from './provenance.js';

const METAMODEL_FILE = 'metamodel.schema.yaml';

const PLANE_META: Record<PlaneId, { title: string; description: string }> = {
  'cross-cutting': {
    title: 'Cross-cutting',
    description:
      'Version-root schemas that belong to neither plane and apply across every layer: root composition, the shared metamodel (the legend), and model migrations.',
  },
  design: {
    title: 'Design Plane',
    description: 'What & how: domain model, behavior, contracts, and quality attributes.',
  },
  governance: {
    title: 'Governance Plane',
    description: 'Why & proof: strategic intent, decisions, capabilities, and quality evidence.',
  },
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Extract the def name from a `$ref` like `../metamodel.schema.yaml#/$defs/operation_ref` or `#/$defs/operation`. */
function refDefName(ref: string): string | undefined {
  const idx = ref.indexOf('#/$defs/');
  if (idx === -1) return undefined;
  return ref.slice(idx + '#/$defs/'.length);
}

/** Resolve the file portion of a `$ref` to a version-root-relative POSIX path, or undefined for same-file refs. */
function refTargetFile(ref: string, fromRelPath: string): string | undefined {
  const hashIdx = ref.indexOf('#');
  const filePart = hashIdx === -1 ? ref : ref.slice(0, hashIdx);
  if (!filePart) return undefined; // same-file ref (#/...)
  const fromDir = path.posix.dirname(fromRelPath);
  const resolved = path.posix.normalize(path.posix.join(fromDir, filePart));
  return resolved;
}

/** Build a human-readable, schema-faithful type label for a schema node. */
function resolveType(
  node: Record<string, unknown>,
  fromRelPath: string,
  entityTypeByDef: Map<string, string>,
): TypeInfo {
  const ref = asString(node['$ref']);
  if (ref) {
    const defName = refDefName(ref);
    const targetFile = refTargetFile(ref, fromRelPath);
    const isMetamodel = targetFile === METAMODEL_FILE;
    const entityType = defName && isMetamodel ? entityTypeByDef.get(defName) : undefined;
    if (entityType) {
      return { label: `ref → ${entityType}`, ref, refEntityType: entityType };
    }
    return { label: `ref → ${defName ?? ref}`, ref };
  }

  const type = node['type'];
  if (type === 'array') {
    const items = node['items'];
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      const itemLabel = resolveType(items as Record<string, unknown>, fromRelPath, entityTypeByDef).label;
      return { label: `array<${itemLabel}>` };
    }
    return { label: 'array' };
  }
  if (typeof type === 'string') return { label: type };
  if (Array.isArray(type)) return { label: type.filter((t) => typeof t === 'string').join(' | ') || 'any' };

  if (Array.isArray(node['oneOf']) || Array.isArray(node['anyOf'])) return { label: 'union' };
  if (Array.isArray(node['allOf'])) return { label: 'composition' };
  if (Array.isArray(node['enum'])) return { label: 'enum' };
  if (node['additionalProperties'] && typeof node['additionalProperties'] === 'object') {
    return { label: 'map<object>' };
  }
  return { label: 'any' };
}

function extractEnum(node: Record<string, unknown>): string[] | undefined {
  const direct = node['enum'];
  if (Array.isArray(direct)) return direct.map((v) => String(v));
  const items = node['items'];
  if (items && typeof items === 'object' && Array.isArray((items as Record<string, unknown>)['enum'])) {
    return ((items as Record<string, unknown>)['enum'] as unknown[]).map((v) => String(v));
  }
  return undefined;
}

function extractProperties(
  container: Record<string, unknown>,
  basePointer: string,
  fromRelPath: string,
  entityTypeByDef: Map<string, string>,
): PropertyInfo[] {
  const props = container['properties'];
  if (!props || typeof props !== 'object') return [];
  const required = new Set(asStringArray(container['required']));
  const out: PropertyInfo[] = [];
  for (const [name, raw] of Object.entries(props as Record<string, unknown>)) {
    const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    out.push({
      name,
      description: asString(node['description']),
      required: required.has(name),
      type: resolveType(node, fromRelPath, entityTypeByDef),
      enumValues: extractEnum(node),
      deprecated: node['deprecated'] === true,
      pointer: `${basePointer}/properties/${jsonPointerEscape(name)}`,
    });
  }
  return out;
}

function jsonPointerEscape(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function extractDefs(
  doc: Record<string, unknown>,
  relPath: string,
  entityTypeByDef: Map<string, string>,
): DefInfo[] {
  const defs = doc['$defs'];
  if (!defs || typeof defs !== 'object') return [];
  const out: DefInfo[] = [];
  for (const [name, raw] of Object.entries(defs as Record<string, unknown>)) {
    const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const pointer = `/$defs/${jsonPointerEscape(name)}`;
    const properties = extractProperties(node, pointer, relPath, entityTypeByDef);
    const hasProps = properties.length > 0 || node['type'] === 'object';
    out.push({
      name,
      title: asString(node['title']),
      description: asString(node['description']),
      kind: hasProps ? 'object' : 'value',
      required: asStringArray(node['required']),
      properties,
      type: resolveType(node, relPath, entityTypeByDef),
      enumValues: extractEnum(node),
      deprecated: node['deprecated'] === true,
      pointer,
    });
  }
  return out;
}

/** Parse the typed-ID vocabulary from the metamodel's `*_ref` definitions (the model's legend). */
function extractEntityTypes(metamodel: LoadedSchema | undefined, version: string): EntityType[] {
  if (!metamodel) return [];
  const defs = metamodel.doc['$defs'];
  if (!defs || typeof defs !== 'object') return [];
  const out: EntityType[] = [];
  for (const [name, raw] of Object.entries(defs as Record<string, unknown>)) {
    if (!name.endsWith('_ref')) continue;
    const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const idPrefix = parseIdPrefix(node);
    if (!idPrefix) continue; // only patterned ID refs are part of the ID vocabulary
    out.push({
      name,
      idPrefix,
      description: asString(node['description']),
      source: sourceRef(version, METAMODEL_FILE, `/$defs/${jsonPointerEscape(name)}`),
    });
  }
  return out.sort((a, b) => a.idPrefix.localeCompare(b.idPrefix) || a.name.localeCompare(b.name));
}

/** Pull the alpha ID prefix (CN, CMD, EVT, …) out of a typed-ID ref pattern. */
function parseIdPrefix(node: Record<string, unknown>): string {
  const patterns: string[] = [];
  const direct = asString(node['pattern']);
  if (direct) patterns.push(direct);
  for (const key of ['anyOf', 'oneOf']) {
    const arr = node[key];
    if (Array.isArray(arr)) {
      for (const sub of arr) {
        if (sub && typeof sub === 'object') {
          const p = asString((sub as Record<string, unknown>)['pattern']);
          if (p) patterns.push(p);
        }
      }
    }
  }
  for (const p of patterns) {
    // Match an uppercase ID token that is immediately followed by a digit matcher.
    const m = p.match(/\(?([A-Z]{1,5}(?:\|[A-Z]{1,5})*)\)?\\d/);
    if (m) return m[1]!.split('|')[0]!;
  }
  return '';
}

/** Walk a schema tree collecting cross-file `$ref` target files. */
function collectCrossFileRefs(node: unknown, fromRelPath: string, counts: Map<string, number>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectCrossFileRefs(item, fromRelPath, counts);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      const target = refTargetFile(value, fromRelPath);
      if (target && target !== fromRelPath) {
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
    } else {
      collectCrossFileRefs(value, fromRelPath, counts);
    }
  }
}

function buildSchemaFile(
  loaded: LoadedSchema,
  version: string,
  entityTypeByDef: Map<string, string>,
): SchemaFile {
  const { relPath, doc } = loaded;
  return {
    relPath,
    plane: planeOf(relPath),
    slug: fileSlug(relPath),
    title: asString(doc['title']) ?? relPath,
    description: asString(doc['description']),
    rootType: asString(doc['type']),
    required: asStringArray(doc['required']),
    properties: extractProperties(doc, '', relPath, entityTypeByDef),
    definitions: extractDefs(doc, relPath, entityTypeByDef),
    source: sourceRef(version, relPath, ''),
  };
}

/** Build the full normalized Atlas model for one schema version. */
export function buildAtlasModel(version: string, schemaDir: string): AtlasModel {
  const loaded = loadSchemaVersion(schemaDir);
  const metamodel = loaded.find((f) => f.relPath === METAMODEL_FILE);

  const entityTypes = extractEntityTypes(metamodel, version);
  const entityTypeByDef = new Map(entityTypes.map((e) => [e.name, e.name] as const));

  const files = loaded.map((l) => buildSchemaFile(l, version, entityTypeByDef));

  const planeMap = new Map<PlaneId, string[]>([
    ['cross-cutting', []],
    ['design', []],
    ['governance', []],
  ]);
  for (const f of files) planeMap.get(f.plane)!.push(f.relPath);
  const planes: Plane[] = (['cross-cutting', 'design', 'governance'] as PlaneId[]).map((id) => ({
    id,
    title: PLANE_META[id].title,
    description: PLANE_META[id].description,
    files: planeMap.get(id)!.slice().sort(),
  }));

  const relations: FileRelation[] = [];
  for (const l of loaded) {
    const counts = new Map<string, number>();
    collectCrossFileRefs(l.doc, l.relPath, counts);
    for (const [toFile, count] of [...counts.entries()].sort()) {
      relations.push({ fromFile: l.relPath, toFile, count });
    }
  }

  return { version, schemaRoot: schemaDir, planes, files, entityTypes, relations };
}
