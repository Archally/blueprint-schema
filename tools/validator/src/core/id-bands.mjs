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

// ── Declared band ownership ───────────────────────────────────────────────────
//
// The other id-band question, and the one a model answers about itself. A slice may reserve
// numeric ranges of a prefix with `layout.slices[].bands[]`, because two entities of one family
// cannot share a number and several slices allocating into one prefix have to divide the space.
//
// It sits beside the retired-band table above for the same reason that one is not hard-coded here:
// both answers are properties of the thing being validated. Retirement is declared by the SCHEMA
// LINE, ownership by the MODEL, and neither is a fact about the tool doing the reading.
//
// OPT-IN, and silent where nothing was reserved. A model declaring no band is reported nothing, a
// prefix nobody banded is unconstrained, and a slice that bands one prefix constrains no other.

/** @typedef {{ prefix: string, from: number, to: number, slice: string, notes?: string }} DeclaredBand */

/**
 * Every band the model declares, with the slice that declared it.
 *
 * Only entries carrying all three required fields with the right types are kept. The schema rejects
 * the rest, and this runs against models nobody validated first.
 *
 * @param {Array<{ schemaType?: string, data?: unknown }>} documents
 * @returns {DeclaredBand[]}
 */
export function declaredBandTable(documents) {
  /** @type {DeclaredBand[]} */
  const bands = [];
  for (const { schemaType, data } of documents) {
    if (schemaType !== "blueprint") continue;
    const record = /** @type {any} */ (data);
    for (const slice of record?.layout?.slices ?? []) {
      if (!slice || typeof slice.name !== "string" || !Array.isArray(slice.bands)) continue;
      for (const band of slice.bands) {
        if (!band || typeof band.prefix !== "string") continue;
        if (typeof band.from !== "number" || typeof band.to !== "number") continue;
        const entry = { prefix: band.prefix, from: band.from, to: band.to, slice: slice.name };
        // `notes` is free text the validator never reads, and the table renders as a column.
        // Dropping it here made the column silently empty for every band that carried one.
        if (typeof band.notes === "string") entry.notes = band.notes;
        bands.push(entry);
      }
    }
  }
  return bands;
}

/** `catalog.CN001` and `CN001` both carry the prefix `CN` and the number 1. */
export function splitTypedId(id) {
  if (typeof id !== "string") return null;
  const bare = id.slice(id.lastIndexOf(".") + 1);
  const match = /^([A-Z]{1,5})(\d+)$/.exec(bare);
  return match ? { prefix: match[1], number: Number.parseInt(match[2], 10) } : null;
}

const renderBand = (band) => `${band.prefix}${band.from}-${band.to}`;

/**
 * Overlaps and inversions, answerable from the declaration alone.
 *
 * Which is the point: the alternative is finding out once two slices have already allocated the
 * same number, when one of them has to give an id back. Sorting by `from` and comparing each band
 * with the one before it reports every clash in one pass. An inverted band is excluded from the
 * overlap pass rather than reported twice - its range is not a range, so "does it intersect" has no
 * answer.
 *
 * @param {DeclaredBand[]} table
 * @returns {string[]}
 */
export function bandDeclarationMessages(table) {
  const messages = [];
  const sound = [];
  for (const band of table) {
    if (band.to < band.from) {
      messages.push(
        `[blueprint.yaml] Slice "${band.slice}" declares band ${band.prefix} ${band.from}-${band.to}, ` +
          `which ends below where it starts and so reserves nothing. Swap the two numbers.`,
      );
      continue;
    }
    sound.push(band);
  }

  const byPrefix = new Map();
  for (const band of sound) {
    const list = byPrefix.get(band.prefix);
    if (list) list.push(band);
    else byPrefix.set(band.prefix, [band]);
  }

  for (const [prefix, list] of [...byPrefix.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort((l, r) => l.from - r.from || l.to - r.to);
    for (let i = 1; i < sorted.length; i++) {
      const band = sorted[i];
      const previous = sorted[i - 1];
      if (band.from > previous.to) continue;
      messages.push(
        `[blueprint.yaml] Two ${prefix} bands cover ${band.from}-${Math.min(previous.to, band.to)}: ` +
          `"${previous.slice}" ${renderBand(previous)} and "${band.slice}" ${renderBand(band)}. ` +
          `Move one of them, or the two slices will allocate the same id.`,
      );
    }
  }
  return messages;
}

/**
 * One id against the bands its slice reserved.
 *
 * Returns null where nothing was reserved for that prefix in that slice - which is not the same as
 * "it fits", and is why the caller counts what it compared.
 *
 * @returns {{ id: string, slice: string, where: string, reserved: string } | null}
 */
export function outOfBandFinding(id, slice, table) {
  if (typeof slice !== "string" || slice === "") return null;
  const typed = splitTypedId(id);
  if (!typed) return null;

  const reserved = table.filter((band) => band.slice === slice && band.prefix === typed.prefix);
  if (reserved.length === 0) return null;
  if (reserved.some((band) => typed.number >= band.from && typed.number <= band.to)) return null;

  const landedIn = table.find(
    (band) => band.prefix === typed.prefix && typed.number >= band.from && typed.number <= band.to,
  );
  const where = landedIn
    ? landedIn.slice === slice
      ? `inside ${renderBand(landedIn)}, which this slice declares for a different range`
      : `inside "${landedIn.slice}"'s band ${renderBand(landedIn)}`
    : "inside no declared band";

  return { id, slice, where, reserved: reserved.map(renderBand).join(", ") };
}

/** @param {{ id: string, slice: string, where: string, reserved: string }} finding */
export function outOfBandMessage(finding, file) {
  return (
    `[${file}] "${finding.id}" is declared in slice "${finding.slice}" and falls ${finding.where}. ` +
    `"${finding.slice}" reserves ${finding.reserved}.`
  );
}
