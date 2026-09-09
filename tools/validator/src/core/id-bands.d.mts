/** One retired id band and the spelling that replaces it. */
export interface RetiredBand {
  old: string;
  new: string;
  entity: string;
  /** The version that widened THIS band's pattern; the block default unless the row overrides it. */
  since: string;
}

/** What a schema line retires, read from that line's `x-retired-bands` block. */
export interface RetiredBandTable {
  /** The version that widened the patterns to accept both spellings. */
  deprecatedSince: string;
  /** The line that stops accepting the old spelling. */
  removedIn: string;
  bands: RetiredBand[];
}

/** Read the retired-band table out of a loaded schema registry; a line declaring none retires none. */
export function retiredBandTable(registry: Map<string, unknown>): RetiredBandTable;

/** The band an id uses, if that band is retired on this line. Whole-band, so `DSC001` is not a `D`. */
export function retiredBandOf(id: string, table?: RetiredBandTable): RetiredBand | undefined;

/** The same id under its new band, scope prefix preserved. */
export function rebanded(id: string, band: RetiredBand): string;

/** The sentence every surface prints for one retired-band finding. */
export function retiredBandMessage(
  finding: { id: string; band: RetiredBand; rebanded: string; loc: string },
  table: RetiredBandTable,
): string;
