// @ts-check
/**
 * Which keys hold a typed reference - read off the schema, never kept by hand.
 *
 * A reference key is a property the schema types as a metamodel `*_ref`, and the schema is the only
 * place that fact is stated - so the set is derived from the schema tree a run validates against,
 * never listed by hand. A list is a second statement of what the schema already says, and the two
 * drift: a key the schema types and the list omits is a reference the walk never resolves, and a
 * model can then carry a dangling one and validate clean.
 *
 * Derived per schema tree, so a v2.6 run resolves the keys v2.6 declares and nothing newer.
 *
 * ## Why a key is qualified by its parent
 *
 * `team` under `owned_by` is a `team_ref`. `team` under `resource_owner` is a free-form team NAME
 * with no pattern at all. A key-only answer cannot hold both, so the derivation records the pair -
 * `owned_by/team` is a reference, `resource_owner/team` is not - because that is the shape the
 * schema states. Arrays are transparent: an item's parent is the key that held the array, so
 * `activities/entry_operation` reads the way an author writes it.
 *
 * ## What counts as a reference definition
 *
 * A `$defs` entry whose name ends in `_ref` and whose value is constrained by a pattern, directly or
 * as an `anyOf`/`oneOf` of patterns. That excludes `tracker_ref` (an external locator with no
 * pattern) and `code_refs` (an array of objects). The typed-id shape is enforced at walk time by
 * `ID_RE`, so a key derived here whose value is not id-shaped is left alone.
 */

/** Names of the two definitions that also accept the `scope:key` form. */
const KEYED_REF_DEFS = new Set(["operation_ref", "error_ref"]);

/** Keys that DECLARE an id rather than reference one, wherever the schema types them. */
const DECLARATION_KEYS = new Set(["id", "x-model-id"]);

const DEFS_REF = /^([^#]*)#\/\$defs\/([A-Za-z0-9_-]+)$/;

/**
 * @typedef {object} ReferenceKeys
 * @property {Map<string, Set<string>>} pairs `parent/key` -> the reference definitions it is typed as
 * @property {Set<string>} keys every key that is a reference under at least one parent
 * @property {(parent: string, key: string) => boolean} isReference
 * @property {(parent: string, key: string) => Set<string>} defsOf
 * @property {(parent: string, key: string) => boolean} acceptsKeyedForm the `scope:key` shape is legal here
 */

/**
 * Derive the reference keys a schema tree declares.
 *
 * @param {Map<string, any>} registry schema documents keyed by path relative to the schema root,
 *   POSIX separators - the shape `loadSchemaRegistry` returns.
 * @returns {ReferenceKeys}
 */
export function deriveReferenceKeys(registry) {
  /** @type {Map<string, Set<string>>} */
  const pairs = new Map();
  const visited = new Set();

  const refDefNames = collectReferenceDefinitions(registry);

  /** Resolve a `$ref` string from `fromFile` to `{ file, name, schema }`, or null. */
  const resolve = (ref, fromFile) => {
    const match = DEFS_REF.exec(ref);
    if (!match) {
      const file = normalise(fromFile, ref);
      const schema = registry.get(file);
      return schema ? { file, name: null, schema } : null;
    }
    const file = match[1] ? normalise(fromFile, match[1]) : fromFile;
    const schema = registry.get(file)?.$defs?.[match[2]];
    return schema ? { file, name: match[2], schema } : null;
  };

  /** The reference definitions a property schema resolves to, through arrays and alternatives. */
  const refDefsOf = (schema, fromFile) => {
    if (!schema || typeof schema !== "object") return [];
    if (typeof schema.$ref === "string") {
      const target = resolve(schema.$ref, fromFile);
      if (!target || !target.name) return [];
      const qualified = `${target.file}#${target.name}`;
      return refDefNames.has(qualified) ? [target.name] : [];
    }
    const found = [];
    for (const alternative of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
      found.push(...refDefsOf(alternative, fromFile));
    }
    if (schema.type === "array" || schema.items) found.push(...refDefsOf(schema.items, fromFile));
    return found;
  };

  /** Walk one object-shaped schema, recording every property under `parent`. */
  const descend = (schema, parent, fromFile) => {
    if (!schema || typeof schema !== "object") return;
    if (typeof schema.$ref === "string") {
      const target = resolve(schema.$ref, fromFile);
      if (!target) return;
      const stamp = `${target.file}#${target.name ?? ""}@${parent}`;
      if (visited.has(stamp)) return;
      visited.add(stamp);
      descend(target.schema, parent, target.file);
      return;
    }
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      const defs = refDefsOf(property, fromFile);
      if (defs.length > 0 && !DECLARATION_KEYS.has(key)) {
        const pairKey = `${parent}/${key}`;
        const set = pairs.get(pairKey) ?? new Set();
        for (const def of defs) set.add(def);
        pairs.set(pairKey, set);
      }
      descend(property, key, fromFile);
    }
    // Arrays are transparent, a map's values sit under the map's key, and every alternative of a
    // union describes the same instance position.
    if (schema.items) descend(schema.items, parent, fromFile);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      descend(schema.additionalProperties, parent, fromFile);
    }
    for (const value of Object.values(schema.patternProperties ?? {})) descend(value, parent, fromFile);
    for (const alternative of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
      descend(alternative, parent, fromFile);
    }
  };

  for (const [file, schema] of registry) descend(schema, "", file);

  const keys = new Set([...pairs.keys()].map((pair) => pair.slice(pair.lastIndexOf("/") + 1)));
  const empty = new Set();
  return {
    pairs,
    keys,
    isReference: (parent, key) => pairs.has(`${parent}/${key}`),
    defsOf: (parent, key) => pairs.get(`${parent}/${key}`) ?? empty,
    acceptsKeyedForm: (parent, key) => {
      for (const def of pairs.get(`${parent}/${key}`) ?? []) if (KEYED_REF_DEFS.has(def)) return true;
      return false;
    },
  };
}

/**
 * Every `$defs` entry across the tree that IS a typed reference, as `file#name`.
 *
 * Name and shape both, because the name alone admits `tracker_ref` and `code_refs`, neither of
 * which holds an in-model typed id.
 */
function collectReferenceDefinitions(registry) {
  const names = new Set();
  for (const [file, schema] of registry) {
    for (const [name, definition] of Object.entries(schema?.$defs ?? {})) {
      if (!/_refs?$/.test(name)) continue;
      if (isPatterned(definition)) names.add(`${file}#${name}`);
    }
  }
  return names;
}

function isPatterned(definition) {
  if (!definition || typeof definition !== "object") return false;
  if (typeof definition.pattern === "string") return true;
  const alternatives = definition.anyOf ?? definition.oneOf;
  return Array.isArray(alternatives) && alternatives.some((alternative) => isPatterned(alternative));
}

/** Resolve `target` (a relative schema path) against the directory of `fromFile`, POSIX. */
function normalise(fromFile, target) {
  const base = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")).split("/") : [];
  const segments = [...base];
  for (const part of target.split("/")) {
    if (part === "..") segments.pop();
    else if (part !== "." && part !== "") segments.push(part);
  }
  return segments.join("/");
}
