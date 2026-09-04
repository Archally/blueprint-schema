// @ts-check
/**
 * Reference integrity over a blueprint model: what declares an id, what references one, and the
 * edge constructs that resolve while relating nothing.
 *
 * WHICH keys hold a reference is not decided here. The schema types every reference as a
 * metamodel `*_ref`, and `reference-keys.mjs` reads that off the schema tree once per run; the walk
 * below takes the result and asks it, parent and key together. A key the schema does not type is
 * still a reference when its value is a scope-qualified typed id, because nothing else is written
 * that way - so a free-form bag can carry a reference and it is still resolved.
 */

export const ID_RE = /^([a-z][a-z0-9-]*\.)?[A-Z]{1,4}\d{3,}$/;

/** The scope-qualified form alone - the one shape that is a reference wherever it appears. */
const SCOPED_ID_RE = /^[a-z][a-z0-9-]*\.[A-Z]{1,4}\d{3,}$/;

/**
 * Format 2 of `operation_ref` and `error_ref`: the declaring document's scope and the entry's key
 * in the `operations` / `errors` map, `orders:placeOrder`. Anchored so a stray colon cannot match.
 */
export const KEYED_REF_RE = /^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9]*$/;

/** Keys that DECLARE an id. `x-model-id` is the models layer's, where `id` means something else. */
const DECLARATION_KEYS = new Set(["id", "x-model-id"]);

/** A scoped id under one of these illustrates a shape; it references nothing. */
const EXAMPLE_KEYS = new Set(["example", "examples"]);

/** The two maps whose entry KEYS are addressable through format 2. */
const KEYED_MAPS = new Set(["operations", "errors"]);

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
 * Everything else stays demotable. "What counts as a reference" is the derived key set the caller
 * passes, so this and the reference walk read one definition. Key-only rather than parent-qualified
 * here, deliberately: this decides what `--compat` may RELAX, and over-including keeps an error
 * fatal, which is the safe direction.
 *
 * @returns true when the error must stay fatal even under --compat.
 */
export function isIdentityOrReferenceViolation(instancePath, message, refKeys) {
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
    if (key === "id" || refKeys.keys.has(key)) return true;
  } else if (/required property/i.test(text)) {
    return true;
  }

  // Reduce the Ajv instancePath to its last named segment: "/concepts/0/id" → "id".
  const segments = String(instancePath ?? "")
    .split("/")
    .filter((segment) => segment !== "" && !/^\d+$/.test(segment));
  const leaf = segments[segments.length - 1];
  if (!leaf) return false;
  return leaf === "id" || refKeys.keys.has(leaf);
}

export function collectIds(node, ids = new Map(), duplicates = new Map(), pathStack = []) {
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectIds(item, ids, duplicates, [...pathStack, `[${idx}]`]));
    return { ids, duplicates };
  }
  if (!node || typeof node !== "object") return { ids, duplicates };

  for (const key of DECLARATION_KEYS) {
    const declared = node[key];
    if (typeof declared !== "string" || !ID_RE.test(declared)) continue;
    const loc = pathStack.join(".") || "root";
    if (ids.has(declared)) {
      const current = duplicates.get(declared) ?? [ids.get(declared)];
      current.push(loc);
      duplicates.set(declared, current);
    } else {
      ids.set(declared, loc);
    }
  }

  for (const [k, v] of Object.entries(node)) {
    collectIds(v, ids, duplicates, [...pathStack, k]);
  }
  return { ids, duplicates };
}

/**
 * The format-2 names a document declares: `<scope>:<key>` for every entry of its `operations` and
 * `errors` maps. Merged into the id set so a keyed reference resolves through the same lookup as a
 * typed id. Nothing is collected when the document declares no scope, because the form has no
 * meaning without one.
 */
export function collectKeyedIds(node, scope, ids = new Map(), pathStack = []) {
  if (!scope) return ids;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectKeyedIds(item, scope, ids, [...pathStack, `[${idx}]`]));
    return ids;
  }
  if (!node || typeof node !== "object") return ids;
  for (const [k, v] of Object.entries(node)) {
    if (KEYED_MAPS.has(k) && v && typeof v === "object" && !Array.isArray(v)) {
      for (const entryKey of Object.keys(v)) {
        const keyed = `${scope}:${entryKey}`;
        if (!ids.has(keyed)) ids.set(keyed, [...pathStack, k, entryKey].join("."));
      }
    }
    collectKeyedIds(v, scope, ids, [...pathStack, k]);
  }
  return ids;
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
 * Every reference a document makes, with where it was written.
 *
 * Two ways in. A key the schema types as a reference (`refKeys`, parent-qualified) yields its
 * string value, or each string of its array, when the value is a typed id - or the `scope:key`
 * form, where the definition allows it. A key the schema does NOT type still yields a value that
 * is a scope-qualified typed id, since that spelling is a reference wherever it appears; the bare
 * form is not read there, because a bare `TM001` under an untyped key could be a name. Arrays are
 * transparent: an item is walked with the key that held the array as its parent.
 */
export function collectRefs(node, refs = [], pathStack = [], refKeys, parent = "") {
  if (!refKeys) throw new Error("collectRefs needs the derived reference keys; see reference-keys.mjs");
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectRefs(item, refs, [...pathStack, `[${idx}]`], refKeys, parent));
    return refs;
  }
  if (!node || typeof node !== "object") return refs;

  for (const [k, v] of Object.entries(node)) {
    if (refKeys.isReference(parent, k)) {
      const keyedOk = refKeys.acceptsKeyedForm(parent, k);
      const accept = (value) => ID_RE.test(value) || (keyedOk && KEYED_REF_RE.test(value));
      if (typeof v === "string" && accept(v)) {
        refs.push({ key: k, value: v, loc: [...pathStack, k].join(".") });
      } else if (Array.isArray(v)) {
        v.forEach((item, idx) => {
          if (typeof item === "string" && accept(item)) {
            refs.push({ key: k, value: item, loc: [...pathStack, `${k}[${idx}]`].join(".") });
          }
        });
      }
    } else if (!DECLARATION_KEYS.has(k) && !EXAMPLE_KEYS.has(k)) {
      if (typeof v === "string" && SCOPED_ID_RE.test(v)) {
        refs.push({ key: k, value: v, loc: [...pathStack, k].join(".") });
      } else if (Array.isArray(v)) {
        v.forEach((item, idx) => {
          if (typeof item === "string" && SCOPED_ID_RE.test(item)) {
            refs.push({ key: k, value: item, loc: [...pathStack, `${k}[${idx}]`].join(".") });
          }
        });
      }
    }
    if (v && typeof v === "object" && !EXAMPLE_KEYS.has(k)) {
      collectRefs(v, refs, [...pathStack, k], refKeys, k);
    }
  }
  return refs;
}

/**
 * Edge constructs: a container key, and the arms inside each item that name the edge's TARGET.
 *
 * These are directed edges nested on their source, so an entry naming the declaring entity's own id
 * is an edge from a thing to itself. It relates nothing, no consumer can walk it, and every id in it
 * resolves - so the reference walk above sees a model in perfect order.
 *
 * A table rather than a rule over every reference, because naming your own id is not wrong
 * everywhere. A block carrying a back-pointer to the record it belongs to states its own provenance
 * and is correct read on its own. What separates these is that the object IS an edge: it exists only
 * to relate two units, so the two ends being equal empties it.
 *
 * Matching is on the literal id, the same comparison the reference walk makes. A scope prefix is
 * part of an id here, so `billing.TM001` and `TM001` are two ids - and a reference to one from a
 * file declaring the other is already reported as dangling.
 */
const EDGE_TARGET_ARMS = new Map([
  ["interacts_with", ["team_ref", "department_ref", "party_ref"]],
  ["relations", ["party_ref", "target"]],
]);

/**
 * Every edge that names its own declarer, with the id, the construct and where it was written.
 *
 * The declarer is the NEAREST enclosing object carrying a typed id, so a team nested inside a party
 * is judged against its own id rather than the party's.
 */
export function collectSelfEdges(node, hits = [], declarer = null, pathStack = []) {
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectSelfEdges(item, hits, declarer, [...pathStack, `[${idx}]`]));
    return hits;
  }
  if (!node || typeof node !== "object") return hits;

  const own =
    typeof node.id === "string" && ID_RE.test(node.id) ? node.id : declarer;

  for (const [key, value] of Object.entries(node)) {
    const arms = EDGE_TARGET_ARMS.get(key);
    if (arms && own && Array.isArray(value)) {
      value.forEach((edge, idx) => {
        if (!edge || typeof edge !== "object" || Array.isArray(edge)) return;
        for (const arm of arms) {
          if (edge[arm] === own) {
            hits.push({ id: own, key, arm, loc: [...pathStack, `${key}[${idx}]`, arm].join(".") });
          }
        }
      });
    }
    collectSelfEdges(value, hits, own, [...pathStack, key]);
  }
  return hits;
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
