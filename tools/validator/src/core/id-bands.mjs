// @ts-check
/**
 * The typed id bands a schema line retires, and what each becomes.
 *
 * The table is not written here. It is `x-retired-bands` in that line's `metamodel.schema.yaml`,
 * and this module only reads it, so the answer to "is `D001` a retired spelling?" is a property of
 * the schema being validated rather than of the tool doing the validating. A model on a line whose
 * metamodel carries no such block is reported nothing, which is correct: there the short spelling
 * is the current one, and a hard-coded table would report every id in it.
 *
 * WHY A BAND IS RETIRED. A one-letter band is a prefix-collision hazard against every longer band
 * starting with the same letter, and a schema that has to say which of two bands it means is
 * describing an ambiguity rather than a convention. `AS###` moves with the one-letter bands
 * because `AS###` beside `ASM###` would rebuild that adjacency one letter along.
 *
 * ACCEPT BOTH, REPORT THE OLD. Each pattern accepts the old band and the new one, so a document
 * valid before the widening is valid after it. The old form is reported as a warning naming its
 * replacement and the line that stops accepting it.
 */

/** @typedef {{ old: string, new: string, entity: string, since: string }} RetiredBand */
/**
 * @typedef {object} RetiredBandTable
 * @property {string} deprecatedSince the version that widened the FIRST patterns; a band widened
 *   later carries its own `since`, and that is what a report names
 * @property {string} removedIn the line that stops accepting the old spelling
 * @property {RetiredBand[]} bands
 */

/** A line that retires nothing. Returned whenever the metamodel declares no table. */
function emptyTable() {
  return { deprecatedSince: "", removedIn: "", bands: [] };
}

/**
 * Read the retired-band table out of a loaded schema registry.
 *
 * @param {Map<string, any>} registry keyed by path relative to the schema directory
 * @returns {RetiredBandTable}
 */
export function retiredBandTable(registry) {
  const metamodel = registry instanceof Map ? registry.get("metamodel.schema.yaml") : undefined;
  const declared = metamodel && typeof metamodel === "object" ? metamodel["x-retired-bands"] : undefined;
  if (!declared || typeof declared !== "object" || !Array.isArray(declared.bands)) return emptyTable();
  const bands = declared.bands.filter(
    (band) =>
      band && typeof band.old === "string" && typeof band.new === "string" && band.old !== band.new,
  );
  if (bands.length === 0) return emptyTable();
  const declaredSince = typeof declared.deprecated_since === "string" ? declared.deprecated_since : "";
  return {
    deprecatedSince: declaredSince,
    removedIn: typeof declared.removed_in === "string" ? declared.removed_in : "",
    bands: bands.map((band) => ({
      old: band.old,
      new: band.new,
      entity: typeof band.entity === "string" ? band.entity : band.new,
      // A band widened after the block was written names its own version, so a report cannot tell
      // a reader their spelling has been accepted since a release that did not accept it.
      since: typeof band.since === "string" ? band.since : declaredSince,
    })),
  };
}

/**
 * The band an id uses, if that band is retired on this line - otherwise undefined.
 *
 * Whole-band by construction: the band is every leading letter of the LOCAL part, so `DSC001`
 * yields `DSC` and `orders.D001` yields `D`. Reading the first letter alone is the greedy match
 * the retirement exists to make impossible.
 *
 * @param {string} id
 * @param {RetiredBandTable} table
 * @returns {RetiredBand | undefined}
 */
export function retiredBandOf(id, table) {
  if (typeof id !== "string" || !table || table.bands.length === 0) return undefined;
  const local = id.slice(id.lastIndexOf(".") + 1);
  const match = /^([A-Za-z]+)\d{3,}$/.exec(local);
  if (!match) return undefined;
  return table.bands.find((band) => band.old === match[1]);
}

/**
 * The same id under its new band. The scope prefix is preserved, which is the half a tool tested
 * only on bare ids gets wrong.
 *
 * @param {string} id
 * @param {RetiredBand} band
 * @returns {string}
 */
export function rebanded(id, band) {
  const dot = id.lastIndexOf(".");
  const prefix = dot === -1 ? "" : id.slice(0, dot + 1);
  return `${prefix}${band.new}${id.slice(dot + 1 + band.old.length)}`;
}

/**
 * The sentence every surface prints for one retired-band finding, so `bp validate` and the model
 * server report one wording for one finding.
 *
 * @param {{ id: string, band: RetiredBand, rebanded: string, loc: string }} finding
 * @param {RetiredBandTable} table
 * @returns {string}
 */
export function retiredBandMessage(finding, table) {
  const declaredSince = finding.band.since || table.deprecatedSince;
  const since = declaredSince ? ` Accepted since ${declaredSince},` : " Accepted here,";
  const removal = table.removedIn ? ` rejected in ${table.removedIn}.` : " rejected in the next major line.";
  return (
    `Retired ID band: '${finding.id}' at ${finding.loc} uses ${finding.band.old}### ` +
    `(${finding.band.entity}); write '${finding.rebanded}'.${since}${removal}`
  );
}
