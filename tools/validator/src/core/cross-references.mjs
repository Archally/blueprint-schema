// @ts-check
/**
 * Cross-reference integrity over a whole model, as structured findings.
 *
 * One implementation, consumed by every validator surface: the standalone validator renders these
 * findings as its "Cross-Reference Errors", and the model server renders the same findings into
 * its validation report, so `bp validate` and MCP `get_validation` cannot disagree about whether
 * a reference resolves. Each surface decides how to word a finding; none decides what one is.
 *
 * Four classes. A MISSING reference names an id nothing declares. A DUPLICATE id is declared
 * twice, except a party, which is re-declared by design across arch slices and the org layer. A
 * PARENT CYCLE is a `parent` chain that never terminates - every id in it resolves, so the walk
 * above cannot see it. A SELF EDGE is a relation naming its own declarer - it resolves too, and
 * relates nothing.
 */

import {
  collectIds,
  collectKeyedIds,
  collectParentEdges,
  collectRefs,
  collectSelfEdges,
  findParentCycles,
  isPartyRedeclaration,
} from "./references.mjs";

/** `RT###` refs point to the resource-type CATALOG in the profiles, never into the model. */
export const CATALOG_REF_RE = /^([a-z][a-z0-9-]*\.)?RT\d{3,}$/;

/**
 * @typedef {object} ModelDocument
 * @property {string} relFile path relative to the model root, POSIX separators
 * @property {unknown} data the parsed YAML
 */

/**
 * @typedef {object} ReferenceFindings
 * @property {Array<{ value: string, loc: string, file: string }>} missing
 * @property {Array<{ id: string, locations: string[] }>} duplicates
 * @property {string[][]} parentCycles each ring in walk order, rotated to its lowest member
 * @property {Array<{ id: string, key: string, arm: string, loc: string, file: string }>} selfEdges
 */

/**
 * Resolve every reference the documents make against every id they declare.
 *
 * A reference is resolved against the whole model. A bare id (`CN001`) is ALSO tried against the
 * scope its own document declares, and only that one: the prefix is optional by schema, so a bare
 * id inside a scoped file names that file's scope, while a search across every scope would
 * resolve a typo to whichever slice happened to own the number. The `scope:key` form is declared
 * by the map entries of a scoped document, its scope being the declared one or else the folder -
 * the same fallback the model loader applies, so a reference resolves here iff the builder
 * resolves it.
 *
 * @param {ModelDocument[]} documents every readable document, whether or not a schema knows it
 * @param {import("./reference-keys.mjs").ReferenceKeys} refKeys
 * @returns {ReferenceFindings}
 */
export function resolveModelReferences(documents, refKeys) {
  const allIds = new Map();
  const allDuplicates = new Map();
  const parentEdges = new Map();
  const selfEdges = [];
  const allRefs = [];

  for (const { relFile, data } of documents) {
    if (!data || typeof data !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (data);
    const declaredScope = typeof record.scope === "string" ? record.scope : null;
    const folderScope = relFile.includes("/") ? relFile.slice(0, relFile.indexOf("/")) : null;

    collectIds(data, allIds, allDuplicates, [relFile]);
    collectKeyedIds(data, declaredScope ?? folderScope, allIds, [relFile]);
    collectParentEdges(data, parentEdges);
    collectSelfEdges(data, selfEdges, null, [relFile]);
    for (const ref of collectRefs(data, [], [relFile], refKeys)) {
      allRefs.push({ ...ref, scope: declaredScope, file: relFile });
    }
  }

  const missing = [];
  for (const ref of allRefs) {
    if (CATALOG_REF_RE.test(ref.value)) continue;
    if (allIds.has(ref.value)) continue;
    if (!ref.value.includes(".") && ref.scope && allIds.has(`${ref.scope}.${ref.value}`)) continue;
    missing.push({ value: ref.value, loc: ref.loc, file: ref.file });
  }

  const duplicates = [];
  for (const [id, locations] of allDuplicates.entries()) {
    if (isPartyRedeclaration(locations)) continue;
    duplicates.push({ id, locations });
  }

  return {
    missing,
    duplicates,
    parentCycles: findParentCycles(parentEdges),
    selfEdges: selfEdges.map((edge) => ({ ...edge, file: edge.loc.split(".")[0] })),
  };
}
