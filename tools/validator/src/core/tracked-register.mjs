// @ts-check
/**
 * What a tracked migration register says about the model it sits beside.
 *
 * The register (`.blueprint/migrations.yaml`) lives outside the model directory, so neither the
 * reference walk nor the semantic checks over the built model reach it. Its entries still name
 * things the model declares - a change stream, an owning team, decisions, the contexts and domains a
 * migration reaches - and those names resolve against the model exactly as a register entry inside
 * the model does: an id nothing declares is a cross-reference error.
 *
 * Three further statements are checked here as warnings, the same ones the semantic checks make for
 * migration documents and register entries:
 *
 *   - an entry names no owner, or names a department or party rather than the team that carries it
 *     out. A name alone is a complete owner statement for a unit the model does not declare yet and
 *     is not reported;
 *   - an entry of `depends_on_reasons` names a migration its `depends_on` does not list, or names a
 *     migration a second time;
 *   - variants of one `variant_group` belong to different change streams, so a map would draw
 *     competing answers to one question in two places. An entry with no stream counts as "no change
 *     stream".
 *
 * Only the entry-level fields are read. A `change_set` describes model content that may not exist
 * yet, so its ids are not resolved here; replaying it is what checks them.
 */

import { collectIds } from "./references.mjs";
import { indexDeclarations, resolveReference } from "./ref-resolve.mjs";

const OWNER_ARMS = /** @type {const} */ (["team", "department", "party"]);
const CONTEXT_ID = /^([a-z][a-z0-9-]*\.)?BC\d{3,}$/;

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item !== "") : [];
}

/**
 * Index every id the model's documents declare.
 *
 * @param {Array<{ relFile: string, data: unknown }>} documents the model's parsed documents
 */
export function indexModelDeclarations(documents) {
  const declarations = [];
  for (const { relFile, data } of documents) {
    if (!data || typeof data !== "object") continue;
    const declared = new Map();
    collectIds(data, declared, new Map(), [relFile]);
    for (const [id, loc] of declared) declarations.push({ id, handle: loc });
  }
  return indexDeclarations(declarations);
}

/**
 * The references each entry makes to the model, with the field each sits at.
 *
 * @param {Record<string, unknown>} entry
 * @returns {Array<{ value: string, field: string }>}
 */
function entryReferences(entry) {
  const refs = [];
  const stream = entry.change_stream_ref;
  if (typeof stream === "string" && stream !== "") refs.push({ value: stream, field: "change_stream_ref" });
  const owner = asRecord(entry.owned_by);
  for (const arm of OWNER_ARMS) {
    const value = owner?.[arm];
    if (typeof value === "string" && value !== "") refs.push({ value, field: `owned_by.${arm}` });
  }
  strings(entry.related_decisions).forEach((value, index) => refs.push({ value, field: `related_decisions[${index}]` }));
  const reach = asRecord(entry.reach);
  strings(reach?.bounded_context_refs).forEach((value, index) => {
    // The kebab-name form of a context reference is a name, not an id, as everywhere else.
    if (CONTEXT_ID.test(value)) refs.push({ value, field: `reach.bounded_context_refs[${index}]` });
  });
  strings(reach?.domain_refs).forEach((value, index) => refs.push({ value, field: `reach.domain_refs[${index}]` }));
  return refs;
}

/** @param {Record<string, unknown>} entry @param {number} index */
function labelOf(entry, index) {
  return typeof entry.id === "string" && entry.id !== "" ? entry.id : `entry ${index}`;
}

/**
 * Check a tracked register's entries against the model.
 *
 * @param {unknown} register the parsed register (a sequence of entries)
 * @param {ReturnType<typeof indexDeclarations>} index the model's declarations
 * @param {string} rel the register's name as findings show it
 * @returns {{ crossErrors: string[], warnings: string[] }}
 */
export function trackedRegisterFindings(register, index, rel) {
  const crossErrors = [];
  const warnings = [];
  if (!Array.isArray(register)) return { crossErrors, warnings };

  /** @type {Map<string, Array<{ id: string, stream: string | null }>>} */
  const groups = new Map();

  register.forEach((item, position) => {
    const entry = asRecord(item);
    if (!entry) return;
    const id = labelOf(entry, position);
    const at = `${rel} [${position}]`;

    for (const { value, field } of entryReferences(entry)) {
      if (resolveReference(index, value).status !== "unresolved") continue;
      crossErrors.push(`Missing reference '${value}' at ${at}.${field} (tracked migration ${id})`);
    }

    const owner = asRecord(entry.owned_by);
    if (!owner) {
      warnings.push(`[${rel}] Tracked migration ${id} names no owner: state the team that carries it out in \`owned_by.team\``);
    } else if (typeof owner.team !== "string" || owner.team === "") {
      const arm = ["department", "party"].find((name) => typeof owner[name] === "string" && owner[name] !== "");
      if (arm) {
        warnings.push(`[${rel}] Tracked migration ${id} names a ${arm} (${owner[arm]}) as its owner: a migration is carried out by one team, named in \`owned_by.team\``);
      }
    }

    const waits = new Set(strings(entry.depends_on));
    const named = new Set();
    for (const reason of Array.isArray(entry.depends_on_reasons) ? entry.depends_on_reasons : []) {
      const migration = asRecord(reason)?.migration;
      if (typeof migration !== "string" || migration === "") continue;
      if (named.has(migration)) {
        warnings.push(`[${rel}] Tracked migration ${id} states a reason for waiting for ${migration} twice in \`depends_on_reasons\``);
        continue;
      }
      named.add(migration);
      if (!waits.has(migration)) {
        warnings.push(`[${rel}] Tracked migration ${id} states a reason for waiting for ${migration}, which its \`depends_on\` does not list`);
      }
    }

    const group = entry.variant_group;
    if (typeof group === "string" && group !== "") {
      const stream = typeof entry.change_stream_ref === "string" && entry.change_stream_ref !== "" ? entry.change_stream_ref : null;
      const members = groups.get(group) ?? [];
      members.push({ id, stream });
      groups.set(group, members);
    }
  });

  for (const [group, members] of groups) {
    const streams = new Set(members.map((member) => member.stream));
    if (streams.size < 2) continue;
    const listed = members.map((member) => `${member.id} (${member.stream ?? "no change stream"})`).join(", ");
    warnings.push(`[${rel}] Variants of group '${group}' belong to different change streams: ${listed}. Variants answer one question, so they belong to one stream`);
  }

  return { crossErrors, warnings };
}
