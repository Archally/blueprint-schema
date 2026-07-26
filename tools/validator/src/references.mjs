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
 * definition. Mirrored in the monorepo's `validate-blueprint.mjs` (D24 — both stacks or neither).
 *
 * @returns true when the error must stay fatal even under --compat.
 */
export function isIdentityOrReferenceViolation(instancePath, message) {
  const required = /must have required property '([^']+)'/.exec(String(message ?? ""));
  if (required) {
    const key = required[1];
    if (key === "id" || isRefKey(key)) return true;
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

export function collectRefs(node, refs = [], pathStack = []) {
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectRefs(item, refs, [...pathStack, `[${idx}]`]));
    return refs;
  }
  if (!node || typeof node !== "object") return refs;

  for (const [k, v] of Object.entries(node)) {
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
