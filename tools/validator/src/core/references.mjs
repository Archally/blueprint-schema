export const ID_RE = /^([a-z][a-z0-9-]*\.)?[A-Z]{1,4}\d{3,}$/;

const REF_KEY_SUFFIXES = ["_ref", "_refs"];

const LIKELY_REF_KEYS = new Set([
  "aggregate",
  "entity",
  "command",
  "query",
  "event",
  "rule",
  "story",
  "concept",
  // Plural form on a structural rule, typed `concept_ref[]` by the rules schema.
  "concepts",
  "decision",
  "capability",
  "test_case",
  "question",
  "model",
  "screen",
  "action",
  "governed_by",
  "triggered_by",
  "emits",
  "consumes",
  "contains",
  "owned_by",
  // `staffed_by` names the team whose members perform an actor's role. Unlike `owned_by`, whose
  // value is an object and whose arms are therefore never reached from here, it carries the id
  // directly, so listing it is all it takes for the reference to resolve.
  "staffed_by",
  "served_by",
  "actor",
  "primary_actor",
  "owner",
  "use_case",
  "user_stories",
  "operations",
  "test_cases",
  "stories",
  "dependencies",
  "ref",
  "stakeholders",
  // `target` names the endpoint of a directed relation and carries a typed id, so it takes part
  // in reference integrity like any other ref key.
  "target",
  // `subject_party` names the party a model is written from. It carries the id directly, so listing
  // it here is all the resolution it needs.
  "subject_party",
  // `parent` names a container of the SAME type as the thing declaring it - a department inside a
  // department, a deployment scope inside a scope. Both carry a typed id, and the ID_RE guard below
  // means a `parent` holding anything else is left alone rather than reported as a broken reference.
  "parent",
]);

const NON_REF_KEYS = new Set([
  "id",
  "name",
  "title",
  "statement",
  "description",
  "summary",
  "source",
  "version",
  "schemaVersion",
  "scope",
  "category",
  "type",
  "status",
  "method",
  "date",
  "file",
  "term",
  "definition",
  "stereotype",
  "kind",
]);

export function isRefKey(key) {
  if (NON_REF_KEYS.has(key)) return false;
  if (LIKELY_REF_KEYS.has(key)) return true;
  for (const suffix of REF_KEY_SUFFIXES) {
    if (key.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Does this schema error concern an entity's IDENTITY or a typed REFERENCE?
 *
 * `--compat` exists so a model authored against an older minor can still be worked with while it is
 * migrated: a deprecated field or an unknown optional property should not stop the tooling. It was
 * implemented as a single global demotion of *every* schema failure, which also swallowed the two
 * classes that leave a model structurally unusable downstream:
 *
 *   - **identity** — a missing, malformed or non-string `id`. Every entity in the graph is keyed by
 *     it; without one the builder cannot address the entity at all.
 *   - **references** — a `*_ref` / `*_refs[]` that is absent or the wrong shape. Relations are built
 *     from these, so a demoted reference error becomes a silently missing edge rather than a warning.
 *
 * Everything else stays demotable. Reuses `isRefKey` so "what counts as a reference" has exactly one
 * definition. Was mirrored in the per-version `validate-blueprint.mjs` copies (D24); those are retired, so this is the one definition.
 *
 * @returns true when the error must stay fatal even under --compat.
 */
export function isIdentityOrReferenceViolation(instancePath, message) {
  // A `required` failure is the one case the instancePath cannot classify: Ajv points it at the
  // PARENT object ("/concepts/0"), never at the missing key, so the key has to come from the text.
  //
  // Measured against the pinned Ajv 8.20: the message is `must have required property 'id'` —
  // single quotes, deterministically, including when the property name itself contains a quote.
  // (Ajv has no locale mechanism here; ajv-i18n is a separate opt-in package this stack does not use.)
  //
  // The parse is therefore correct today, and the guard below is for the day it is not: if a message
  // announces a missing required property but the key cannot be read out of it, FAIL SAFE and keep
  // the error fatal. Getting this wrong in the other direction is silent — a missing `id` would be
  // quietly demoted to a warning under --compat and the model would build with an unaddressable entity.
  //
  // The guard covers a change in Ajv's ENGLISH message format (quoting, wording). It cannot cover
  // localization: a translated message matches nothing here and every required-error would become
  // demotable. So installing `ajv-i18n` in either validator stack is a decision that has to come
  // back to this function — it is not a drop-in.
  const text = String(message ?? "");
  const required = /must have required property '([^']+)'/.exec(text);
  if (required) {
    const key = required[1];
    if (key === "id" || isRefKey(key)) return true;
  } else if (/required property/i.test(text)) {
    return true;
  }

  // Reduce the Ajv instancePath to its last named segment: "/concepts/0/id" → "id".
  const segments = String(instancePath ?? "")
    .split("/")
    .filter((segment) => segment !== "" && !/^\d+$/.test(segment));
  const leaf = segments[segments.length - 1];
  if (!leaf) return false;
  return leaf === "id" || isRefKey(leaf);
}

export function collectIds(node, ids = new Map(), duplicates = new Map(), pathStack = []) {
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectIds(item, ids, duplicates, [...pathStack, `[${idx}]`]));
    return { ids, duplicates };
  }
  if (!node || typeof node !== "object") return { ids, duplicates };

  if (typeof node.id === "string" && ID_RE.test(node.id)) {
    const loc = pathStack.join(".") || "root";
    if (ids.has(node.id)) {
      const current = duplicates.get(node.id) ?? [ids.get(node.id)];
      current.push(loc);
      duplicates.set(node.id, current);
    } else {
      ids.set(node.id, loc);
    }
  }

  for (const [k, v] of Object.entries(node)) {
    collectIds(v, ids, duplicates, [...pathStack, k]);
  }
  return { ids, duplicates };
}

/**
 * A location that declares a party — `…parties.[3]`, at any depth.
 *
 * Also matches the `parties[3]` spelling, so a caller that joins its path stack without a separator
 * before the index is covered too.
 */
const PARTY_DECLARATION = /(?:^|\.)parties\.?\[\d+\]$/;

/**
 * Is this repeated id a party declared in several files rather than a genuine duplicate?
 *
 * A party is dual-sourced and re-declared by design: an arch document requires `parties` at its
 * root, so a context map split across slice folders re-states the party in every slice, and the
 * org layer states it again. The shared `PRT###` is what makes those declarations ONE party — so
 * repeating it is the correct, intended state, not a collision.
 *
 * The exemption is deliberately narrow: EVERY location must be a party declaration. An id used once
 * as a party and once as anything else is still a duplicate, and still reported.
 */
export function isPartyRedeclaration(locations) {
  return locations.length > 1 && locations.every((loc) => PARTY_DECLARATION.test(loc));
}

/**
 * Reference keys whose value is an OBJECT, with the arms inside it that carry an id.
 *
 * `collectRefs` reads a reference from the value AT a key. `owned_by`'s value is an object holding
 * exactly one of `team`, `department` or `party`, so the key matches and the value is neither a
 * string nor an array; the walk then recurses into the object, where the arm names are not
 * reference keys. The id was reached from neither direction, and every ownership statement in every
 * model went unchecked.
 *
 * A table rather than an annotation in the metamodel, because this walk reads the YAML instance and
 * never loads a schema - it could not see an annotation without the schema-traversal machinery that
 * would make the annotation unnecessary. A table of one, because `oneOf` appears exactly once in
 * the metamodel and this is it: there is no class of nested-reference shapes to generalise over.
 *
 * Scoped to the arms of these keys, NOT to the arm names themselves. `team` as a general reference
 * key would claim every key of that name anywhere, including `resource_owner.team`, which holds a
 * free-string team NAME and is a different field with a different meaning.
 */
const NESTED_REF_ARMS = new Map([["owned_by", ["team", "department", "party"]]]);

export function collectRefs(node, refs = [], pathStack = []) {
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectRefs(item, refs, [...pathStack, `[${idx}]`]));
    return refs;
  }
  if (!node || typeof node !== "object") return refs;

  for (const [k, v] of Object.entries(node)) {
    const arms = NESTED_REF_ARMS.get(k);
    if (arms && v && typeof v === "object" && !Array.isArray(v)) {
      for (const arm of arms) {
        const value = v[arm];
        if (typeof value === "string" && ID_RE.test(value)) {
          refs.push({ key: arm, value, loc: [...pathStack, k, arm].join(".") });
        }
      }
    }
    if (isRefKey(k)) {
      if (typeof v === "string" && ID_RE.test(v)) {
        refs.push({ key: k, value: v, loc: [...pathStack, k].join(".") });
      } else if (Array.isArray(v)) {
        v.forEach((item, idx) => {
          if (typeof item === "string" && ID_RE.test(item)) {
            refs.push({ key: k, value: item, loc: [...pathStack, `${k}[${idx}]`].join(".") });
          }
        });
      }
    }
    collectRefs(v, refs, [...pathStack, k]);
  }
  return refs;
}

/**
 * Every `{ id, parent }` pair in the model, wherever it appears.
 *
 * `parent` names a container of the same type as its declarer, which makes it a hierarchy, and a
 * hierarchy can be written as a ring. **A ring is invisible to reference checking**: every id
 * resolves, so `collectRefs` reports nothing, and a consumer walking upward from any member never
 * terminates. The two constructs that use it - a department's parent department and a deployment
 * scope's parent scope - are equally capable of it, so this collects both rather than one.
 *
 * Keyed on the declaring object's own id, so the result is the edge set a walk would follow.
 */
export function collectParentEdges(node, edges = new Map()) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectParentEdges(item, edges));
    return edges;
  }
  if (!node || typeof node !== "object") return edges;

  if (
    typeof node.id === "string" &&
    ID_RE.test(node.id) &&
    typeof node.parent === "string" &&
    ID_RE.test(node.parent)
  ) {
    edges.set(node.id, node.parent);
  }

  for (const value of Object.values(node)) collectParentEdges(value, edges);
  return edges;
}

/**
 * The `parent` chains that close on themselves, each reported once.
 *
 * A self-reference (`A -> A`) is the one-element case and is returned like any other, because it is
 * the same defect: a walk that cannot terminate. Each cycle is rendered starting from its
 * alphabetically lowest member so the same ring reads identically however it was reached, and so two
 * runs over one model produce the same text.
 */
export function findParentCycles(edges) {
  const cycles = [];
  const seen = new Set();

  for (const start of edges.keys()) {
    if (seen.has(start)) continue;

    const path = [];
    const onPath = new Map();
    let current = start;

    while (current !== undefined && !seen.has(current)) {
      if (onPath.has(current)) {
        const ring = path.slice(onPath.get(current));
        // Rotate to the lowest member: one ring, one rendering, whichever node was entered first.
        const lowest = ring.indexOf([...ring].sort()[0]);
        cycles.push([...ring.slice(lowest), ...ring.slice(0, lowest)]);
        break;
      }
      onPath.set(current, path.length);
      path.push(current);
      current = edges.get(current);
    }

    for (const id of path) seen.add(id);
  }

  return cycles;
}
