// @ts-check
/**
 * Structure: does an entity state its facts in fields, or only in prose?
 *
 * The coverage metrics ask whether an entity carries prose that says something. This module asks
 * the other half of the question, with three signals that are reported and never gated:
 *
 *   references held only in prose  ids the entity's description (or a rule's logic) names that no
 *                                  other field of the same entity names, resolved against the ids
 *                                  the model declares, by the exact id as written. Each is marked
 *                                  with whether the entity's schema type has a field that could
 *                                  hold it, so an authoring gap (move it into that field) reads
 *                                  apart from a schema gap (no field exists for it). A mention
 *                                  that names no declared id but differs from one only by a scope
 *                                  prefix is listed apart, as an unresolved mention with the ids
 *                                  it may mean.
 *   fields used                    the authored fields an entity uses, out of those its schema type
 *                                  makes available, identity and prose fields excluded.
 *   description length             context beside the two, never a score of its own.
 *
 * The available set and the reference fields come from the schema's own `$defs`, so they follow
 * the schema without a hand-kept list; only the identity, prose and measured-container lists live
 * in the quality spec. Without a schema the references are still reported and the available set
 * reads as unknown.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { entriesOf, nameOf, typedIdOf } from './collect.mjs';
import { entityKeyOf, idsDifferingOnlyByPrefix } from './entities.mjs';

/** A token shaped like a typed id: an optional dotted scope, 1-4 capitals, 2-5 digits. */
const TOKEN_RE = /\b(?:[a-z][a-z0-9-]*\.)*[A-Z]{1,4}\d{2,5}\b/g;

/** How deep a `$ref` chain is followed when collecting a field's reference patterns. */
const MAX_SCHEMA_DEPTH = 10;

// ── where the schema comes from ─────────────────────────────────────────────

/** `2.8.0` -> `v2.8`. @param {string|undefined} schemaVersion */
function versionDirOf(schemaVersion) {
  const match = /^(\d+)\.(\d+)/.exec(String(schemaVersion ?? ''));
  return match ? `v${match[1]}.${match[2]}` : null;
}

/** The directory the schema files are read from: a version root's `schema/` subdirectory, when it has one. @param {string} root */
function schemaDirOf(root) {
  const nested = path.join(root, 'schema');
  return fs.existsSync(nested) && fs.statSync(nested).isDirectory() ? nested : root;
}

/** @param {string} dir */
function* walkSchemaFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walkSchemaFiles(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.schema.yaml')) {
      yield path.join(dir, entry.name);
    }
  }
}

/** @param {string} candidate */
function holdsSchemas(candidate) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return false;
  return !walkSchemaFiles(schemaDirOf(candidate)).next().done;
}

/** A directory of versions (`<base>/v2.8`) or a version root itself. @param {string} base @param {string|null} version */
function pickVersionDir(base, version) {
  const candidates = version ? [path.join(base, version), base] : [base];
  return candidates.find(holdsSchemas) ?? null;
}

/** Walk up from `from`, trying the monorepo and the published repository layouts. @param {string} version @param {string} from */
function findSchemaRoot(version, from) {
  let directory = path.resolve(from);
  for (let depth = 0; depth < 12; depth++) {
    for (const candidate of [path.join(directory, 'schemas', 'blueprint', version), path.join(directory, 'schema', version)]) {
      if (holdsSchemas(candidate)) return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

/**
 * Find the schema version root the model's types are read from. An explicit `--schemas` that holds
 * no schema for the model's version refuses: the caller named a source and it is not usable. A
 * `BLUEPRINT_SCHEMAS` that does not hold it is passed over with a note, then the layout is searched
 * from the model outwards, from this tool's directory and from the working directory.
 * @param {{explicit?: string, schemaVersion?: string, modelRoot: string, toolDir: string, cwd?: string, env?: Record<string, string|undefined>}} input
 * @returns {{root: string|null, source?: string, note?: string}}
 */
export function locateSchemaRoot({ explicit, schemaVersion, modelRoot, toolDir, cwd = process.cwd(), env = process.env }) {
  const version = versionDirOf(schemaVersion);
  if (explicit) {
    const root = pickVersionDir(path.resolve(explicit), version);
    if (!root) throw new Error(`--schemas ${explicit} holds no ${version ?? 'blueprint'} schema directory`);
    return { root, source: '--schemas' };
  }
  /** @type {string|undefined} */
  let note;
  const fromEnv = env.BLUEPRINT_SCHEMAS?.trim();
  if (fromEnv) {
    const root = pickVersionDir(path.resolve(fromEnv), version);
    if (root) return { root, source: 'BLUEPRINT_SCHEMAS' };
    note = `BLUEPRINT_SCHEMAS (${fromEnv}) holds no ${version ?? 'blueprint'} schema directory`;
  }
  if (!version) return { root: null, note: note ?? 'the model declares no schemaVersion, so no schema was looked up' };
  for (const from of [modelRoot, toolDir, cwd]) {
    const root = findSchemaRoot(version, from);
    if (root) return { root, source: 'layout discovery', note };
  }
  return { root: null, note: note ?? `no ${version} schema directory was found from the model, this tool or the working directory; pass --schemas` };
}

// ── what the schema says each container holds ───────────────────────────────

/**
 * @typedef {object} ContainerType
 * @property {string} type                 the `$defs` name the container's items are
 * @property {string} file                 the schema file defining it
 * @property {string[]} properties         every property the type declares
 * @property {Array<{field: string, pattern: RegExp}>} referencePatterns
 *           the string patterns reachable from each top-level property, the field named
 */

/**
 * Index the schema: for every top-level container key whose items are a local `$defs` type, the
 * type's properties and the reference patterns its fields accept. A container two schema files
 * define with different types maps to `null`, since which one an entity is cannot be told from
 * the container key alone.
 * @param {string} root a schema version root
 * @returns {{root: string, containers: Map<string, ContainerType|null>}}
 */
export function loadSchemaIndex(root) {
  /** @type {Map<string, any>} */
  const documents = new Map();
  const load = (/** @type {string} */ file) => {
    if (!documents.has(file)) {
      let parsed = null;
      try {
        parsed = YAML.parse(fs.readFileSync(file, 'utf8'), { maxAliasCount: -1 });
      } catch {
        parsed = null;
      }
      documents.set(file, parsed);
    }
    return documents.get(file);
  };

  /** @type {Map<string, ContainerType|null>} */
  const containers = new Map();
  for (const file of walkSchemaFiles(schemaDirOf(root))) {
    const doc = load(file);
    for (const [key, property] of Object.entries(doc?.properties ?? {})) {
      const item = property?.items ?? (typeof property?.additionalProperties === 'object' ? property.additionalProperties : undefined);
      const match = /^#\/\$defs\/([^/]+)$/.exec(String(item?.$ref ?? ''));
      const definition = match ? doc?.$defs?.[match[1]] : undefined;
      if (!match || !definition || typeof definition !== 'object') continue;
      const properties = propertiesOf(definition, file, load);
      const candidate = {
        type: match[1],
        file,
        properties: Object.keys(properties),
        referencePatterns: Object.entries(properties).flatMap(([field, schema]) =>
          patternsOf(schema, file, load, new Set(), 0).map((pattern) => ({ field, pattern }))),
      };
      if (!containers.has(key)) {
        containers.set(key, candidate);
        continue;
      }
      const existing = containers.get(key);
      const same = existing && existing.type === candidate.type
        && existing.properties.join('\u0000') === candidate.properties.join('\u0000');
      if (!same) containers.set(key, null);
    }
  }
  return { root, containers };
}

/**
 * Resolve a `$ref` relative to the file it was written in.
 * @param {string} ref @param {string} file @param {(file: string) => any} load
 * @returns {{node: any, file: string}|null}
 */
function resolveRef(ref, file, load) {
  const [target, pointer = ''] = String(ref).split('#');
  const targetFile = target ? path.resolve(path.dirname(file), target) : file;
  if (!fs.existsSync(targetFile)) return null;
  let node = load(targetFile);
  for (const segment of pointer.split('/').filter(Boolean)) {
    node = node?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node === undefined ? null : { node, file: targetFile };
}

/**
 * A type's properties, its own and those of the local types an `allOf` composes.
 * @param {any} definition @param {string} file @param {(file: string) => any} load
 * @returns {Record<string, any>}
 */
function propertiesOf(definition, file, load) {
  /** @type {Record<string, any>} */
  const properties = { ...(definition?.properties ?? {}) };
  for (const branch of Array.isArray(definition?.allOf) ? definition.allOf : []) {
    const resolved = branch?.$ref ? resolveRef(branch.$ref, file, load) : { node: branch, file };
    if (resolved?.node?.properties) Object.assign(properties, { ...resolved.node.properties, ...properties });
  }
  return properties;
}

/**
 * Every string pattern a value of this schema can be checked against, following `$ref`, list
 * items, nested objects and the combinators.
 * @param {any} schema @param {string} file @param {(file: string) => any} load
 * @param {Set<any>} seen @param {number} depth
 * @returns {RegExp[]}
 */
function patternsOf(schema, file, load, seen, depth) {
  if (!schema || typeof schema !== 'object' || seen.has(schema) || depth > MAX_SCHEMA_DEPTH) return [];
  seen.add(schema);
  /** @type {RegExp[]} */
  const patterns = [];
  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, file, load);
    if (resolved) patterns.push(...patternsOf(resolved.node, resolved.file, load, seen, depth + 1));
  }
  if (typeof schema.pattern === 'string') {
    try {
      patterns.push(new RegExp(schema.pattern));
    } catch {
      // A pattern this engine cannot compile names nothing it can test.
    }
  }
  const children = [
    schema.items,
    typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined,
    ...Object.values(schema.properties ?? {}),
    ...['anyOf', 'oneOf', 'allOf'].flatMap((combinator) => (Array.isArray(schema[combinator]) ? schema[combinator] : [])),
  ];
  for (const child of children) patterns.push(...patternsOf(child, file, load, seen, depth + 1));
  return patterns;
}

// ── which ids the model declares, and what a token in prose names ───────────

/**
 * Every typed id the model declares, anywhere in any file, as written. The folder a file sits in
 * is not part of an id: `CN001` filed in `catalog/` is declared as `CN001`.
 * @param {Array<{doc: any}>} documents
 * @returns {Set<string>}
 */
export function declaredIdsOf(documents) {
  /** @type {Set<string>} */
  const declared = new Set();
  const visit = (/** @type {any} */ node, /** @type {Set<any>} */ seen) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, seen);
      return;
    }
    for (const key of ['id', 'x-model-id']) {
      const id = typedIdOf(node[key]);
      if (id) declared.add(id);
    }
    for (const value of Object.values(node)) visit(value, seen);
  };
  for (const { doc } of documents) visit(doc, new Set());
  return declared;
}

/**
 * A resolver from a token to the id the model declares as that exact string. A scope prefix and
 * its dot are part of the id, so `CN001` does not resolve to `catalog.CN001`, nor the reverse.
 * Anything else names nothing the model declares and resolves to `undefined`, so a version string
 * or a code that happens to be shaped like an id is never reported as a reference.
 * @param {Set<string>} declared
 * @returns {(token: string) => string|undefined}
 */
export function resolverFor(declared) {
  return (token) => (declared.has(token) ? token : undefined);
}

// ── the per-entity measure ───────────────────────────────────────────────────

/**
 * @typedef {object} ProseOnlyReference
 * @property {string} id                    the declared id the token resolves to
 * @property {string} written               the token as the prose wrote it
 * @property {string} in                    the field it was read from
 * @property {boolean|null} schemaHasField  whether a field of the entity's type accepts it; null without a schema
 * @property {string[]} fields              the fields that could hold it
 */

/**
 * @typedef {object} UnresolvedReference
 * @property {string} written               the token as the prose wrote it; the model declares no such id
 * @property {string} in                    the field it was read from
 * @property {string[]} didYouMean          the declared ids that differ from it only by a scope prefix, never empty
 */

/**
 * @typedef {object} StructureRecord
 * @property {string} key                   the entity key, as the per-entity rollup builds it
 * @property {string} file
 * @property {string} [slice]
 * @property {string} [entityId]
 * @property {string} name
 * @property {string} kind                  the container key the entity was found under
 * @property {string|null} type             the schema type, when the schema names one
 * @property {string[]} fieldsUsed
 * @property {number|null} fieldsAvailable
 * @property {number} descriptionLength
 * @property {ProseOnlyReference[]} proseOnlyReferences
 * @property {UnresolvedReference[]} unresolvedReferences  mentions that name no declared id; advisory, outside every score
 */

/** A value that states something: not absent, not an empty string, list or map. @param {unknown} value */
function isPresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Every string inside a value, keys excluded. @param {unknown} value @returns {string[]} */
function stringsOf(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/** @param {string} text */
function tokensOf(text) {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * Measure every entity of the containers the spec names.
 * @param {object} input
 * @param {Array<{file: string, doc: any, slice?: string}>} input.documents
 * @param {{root: string, containers: Map<string, ContainerType|null>}|null} input.schemaIndex
 * @param {{containers?: string[], identity_fields?: string[], prose_fields?: string[], reference_text_fields?: string[]}} [input.structureSpec]
 * @returns {StructureRecord[]}
 */
export function measureStructure({ documents, schemaIndex, structureSpec }) {
  if (!structureSpec || !Array.isArray(structureSpec.containers)) return [];
  const identity = new Set(structureSpec.identity_fields ?? []);
  const prose = new Set(structureSpec.prose_fields ?? []);
  const referenceText = structureSpec.reference_text_fields ?? [];
  const declared = declaredIdsOf(documents);
  const resolve = resolverFor(declared);

  /** @type {StructureRecord[]} */
  const records = [];
  for (const { file, doc, slice } of documents) {
    for (const container of structureSpec.containers) {
      for (const [key, node] of entriesOf(doc?.[container])) {
        const entityId = typedIdOf(node.id);
        const name = String(nameOf(node, key));
        const containerType = schemaIndex ? schemaIndex.containers.get(container) ?? null : null;
        const available = containerType
          ? containerType.properties.filter((field) => !identity.has(field) && !prose.has(field))
          : null;
        const availableSet = available ? new Set(available) : null;

        const fieldsUsed = Object.keys(node).filter((field) => isPresent(node[field])
          && !identity.has(field) && !prose.has(field) && (!availableSet || availableSet.has(field)));

        const self = entityId;
        /** @type {Set<string>} */
        const typed = new Set();
        for (const [field, value] of Object.entries(node)) {
          if (identity.has(field) || prose.has(field) || referenceText.includes(field)) continue;
          for (const token of stringsOf(value).flatMap(tokensOf)) {
            const resolved = resolve(token);
            if (resolved) typed.add(resolved);
          }
        }

        /** @type {ProseOnlyReference[]} */
        const proseOnlyReferences = [];
        /** @type {UnresolvedReference[]} */
        const unresolvedReferences = [];
        const reported = new Set();
        const unresolvedSeen = new Set();
        for (const field of referenceText) {
          for (const token of stringsOf(node[field]).flatMap(tokensOf)) {
            const resolved = resolve(token);
            if (!resolved) {
              // A token no declared id spells is reported only when some declared id differs from
              // it by a scope prefix alone; any other id-shaped token (a version, a code) is not one.
              if (unresolvedSeen.has(token)) continue;
              unresolvedSeen.add(token);
              const didYouMean = idsDifferingOnlyByPrefix(declared, token);
              if (didYouMean.length > 0) unresolvedReferences.push({ written: token, in: field, didYouMean });
              continue;
            }
            if (resolved === self || typed.has(resolved) || reported.has(resolved)) continue;
            reported.add(resolved);
            const fields = containerType
              ? [...new Set(containerType.referencePatterns
                .filter(({ field: candidate, pattern }) => !identity.has(candidate) && !prose.has(candidate)
                  && (pattern.test(resolved) || pattern.test(token)))
                .map(({ field: candidate }) => candidate))]
              : [];
            proseOnlyReferences.push({
              id: resolved,
              written: token,
              in: field,
              schemaHasField: containerType ? fields.length > 0 : null,
              fields,
            });
          }
        }

        records.push({
          key: entityKeyOf({ file, entityId, entityName: name }),
          file,
          slice,
          entityId,
          name,
          kind: container,
          type: containerType?.type ?? null,
          fieldsUsed,
          fieldsAvailable: available ? available.length : null,
          descriptionLength: typeof node.description === 'string' ? node.description.length : 0,
          proseOnlyReferences,
          unresolvedReferences,
        });
      }
    }
  }
  return records;
}

// ── the per-kind summary ─────────────────────────────────────────────────────

/** The upper median, as the plan census computes it. @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * One row per measured container, in the spec's order.
 * @param {StructureRecord[]} records
 * @param {string[]} [order] container keys, in the order to report them
 */
export function summarizeStructure(records, order = []) {
  /** @type {Map<string, StructureRecord[]>} */
  const byKind = new Map();
  for (const kind of order) byKind.set(kind, []);
  for (const record of records) {
    const bucket = byKind.get(record.kind) ?? [];
    bucket.push(record);
    byKind.set(record.kind, bucket);
  }
  return [...byKind.entries()]
    .filter(([, bucket]) => bucket.length > 0)
    .map(([kind, bucket]) => {
      const used = bucket.map((record) => record.fieldsUsed.length);
      /** @type {Record<string, number>} */
      const distribution = {};
      for (const count of used) distribution[count] = (distribution[count] ?? 0) + 1;
      /** @type {Record<string, number>} */
      const fieldUse = {};
      for (const record of bucket) for (const field of record.fieldsUsed) fieldUse[field] = (fieldUse[field] ?? 0) + 1;
      const availableValues = [...new Set(bucket.map((record) => record.fieldsAvailable))];
      const lengths = bucket.map((record) => record.descriptionLength);
      const references = bucket.flatMap((record) => record.proseOnlyReferences);
      return {
        kind,
        type: bucket[0].type,
        entities: bucket.length,
        withProseOnlyReferences: bucket.filter((record) => record.proseOnlyReferences.length > 0).length,
        proseOnlyReferences: references.length,
        schemaGapReferences: references.filter((reference) => reference.schemaHasField === false).length,
        unresolvedReferences: bucket.reduce((total, record) => total + record.unresolvedReferences.length, 0),
        fieldsAvailable: availableValues.length === 1 ? availableValues[0] : null,
        fieldsUsed: { median: median(used), max: Math.max(...used), distribution },
        fieldUse,
        descriptionLength: { median: median(lengths), max: Math.max(...lengths) },
      };
    });
}
