// @ts-check
/**
 * Cross-reference integrity over a whole model, as structured findings.
 *
 * One implementation, consumed by every validator surface: the standalone validator renders these
 * findings as its "Cross-Reference Errors", and the model server renders the same findings into
 * its validation report, so `bp validate` and MCP `get_validation` cannot disagree about whether
 * a reference resolves. Each surface decides how to word a finding; none decides what one is.
 *
 * Six classes. A MISSING reference names an id nothing declares. A DUPLICATE id is declared
 * twice, except a party, which is re-declared by design across arch slices and the org layer. A
 * PARENT CYCLE is a `parent` chain that never terminates - every id in it resolves, so the walk
 * above cannot see it. A SELF EDGE is a relation naming its own declarer - it resolves too, and
 * relates nothing. An ENVELOPE CONFLICT is a service nested under one party whose `system_ref`
 * names another - both resolve, and the two statements of which system the service is a component
 * of contradict each other. A RETIRED BAND is an id spelled with a band the schema line still
 * accepts and no longer wants; it resolves, and it stops resolving one line from now.
 */

import { retiredBandOf, rebanded, outOfBandFinding } from "./id-bands.mjs";
import {
  collectIds,
  collectKeyedIds,
  collectParentEdges,
  collectRefs,
  collectSelfEdges,
  collectEnvelopeConflicts,
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
 * @property {Array<{ service: string, declared: string, envelope: string, loc: string, file: string }>} envelopeConflicts
 * @property {Array<{ id: string, band: import("./id-bands.mjs").RetiredBand, rebanded: string, loc: string, file: string }>} retiredBands
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
 * A retired band is reported on the DECLARATION, once per id. A reference to a retired-band id
 * either resolves - to a declaration this pass already names, so repeating it per mention would
 * report one thing hundreds of times - or it does not, and is already a missing reference. The
 * declaration is therefore the complete set, and it is also the thing an author edits.
 *
 * @param {ModelDocument[]} documents every readable document, whether or not a schema knows it
 * @param {import("./reference-keys.mjs").ReferenceKeys} refKeys
 * @param {import("./id-bands.mjs").RetiredBandTable} [bandTable] what this schema line retires;
 *   omitted, nothing is retired, which is the right answer for a line that retires nothing
 * @returns {ReferenceFindings}
 */
export function resolveModelReferences(documents, refKeys, bandTable, declaredBands = []) {
  const allIds = new Map();
  const allDuplicates = new Map();
  // Duplicate detection runs over the whole model in one pass below; the per-document collection
  // above exists so a bare id can be aliased under the scope its own document declares.
  const everything = new Map();
  const parentEdges = new Map();
  const selfEdges = [];
  const envelopeConflicts = [];
  const allRefs = [];
  const retiredBands = new Map();
  // Ownership, beside retirement: the same walk already knows each id and the folder it came from,
  // and the folder IS the slice a band is declared on. Collecting here rather than re-walking the
  // model keeps one traversal answering both id-band questions.
  const outOfBand = new Map();

  for (const { relFile, data } of documents) {
    if (!data || typeof data !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (data);
    const declaredScope = typeof record.scope === "string" ? record.scope : null;
    const folderScope = relFile.includes("/") ? relFile.slice(0, relFile.indexOf("/")) : null;

    const declaredHere = new Map();
    collectIds(data, declaredHere, new Map(), [relFile]);
    for (const [id, loc] of declaredHere) {
      if (!allIds.has(id)) allIds.set(id, loc);
      // The scope prefix is optional on a DECLARATION too: a bare `KPI001` in a document that
      // declares `scope: orders` is `orders.KPI001`, which is the id the model builder gives it
      // and the id another document references it by. The alias is registered only where the
      // qualified id is not itself declared, so a real declaration is never shadowed.
      if (declaredScope && !id.includes(".")) {
        const qualified = `${declaredScope}.${id}`;
        if (!allIds.has(qualified)) allIds.set(qualified, loc);
      }
    }
    for (const [id, loc] of declaredHere) {
      if (retiredBands.has(id)) continue;
      const band = retiredBandOf(id, bandTable);
      if (band) retiredBands.set(id, { id, band, rebanded: rebanded(id, band), loc, file: relFile });
    }
    if (declaredBands.length > 0 && folderScope) {
      for (const [id] of declaredHere) {
        // One finding per id, however many files declare it - the second declaration is a duplicate,
        // which is a different report with its own message.
        if (outOfBand.has(id)) continue;
        const finding = outOfBandFinding(id, folderScope, declaredBands);
        if (finding) outOfBand.set(id, { ...finding, file: relFile });
      }
    }
    collectKeyedIds(data, declaredScope ?? folderScope, allIds, [relFile]);
    collectParentEdges(data, parentEdges);
    collectSelfEdges(data, selfEdges, null, [relFile]);
    for (const conflict of collectEnvelopeConflicts(data, [], [relFile])) {
      envelopeConflicts.push({ ...conflict, file: relFile });
    }
    for (const ref of collectRefs(data, [], [relFile], refKeys)) {
      allRefs.push({ ...ref, scope: declaredScope, file: relFile });
    }
  }

  for (const { relFile, data } of documents) {
    if (!data || typeof data !== "object") continue;
    collectIds(data, everything, allDuplicates, [relFile]);
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
    envelopeConflicts,
    retiredBands: [...retiredBands.values()],
    outOfBand: [...outOfBand.values()],
  };
}
