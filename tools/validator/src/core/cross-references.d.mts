import type { ReferenceKeys } from "./reference-keys.mjs";
import type { RetiredBand, RetiredBandTable } from "./id-bands.mjs";

/** `RT###` refs point to the resource-type catalog in the profiles, never into the model. */
export const CATALOG_REF_RE: RegExp;

export interface ModelDocument {
  /** Path relative to the model root, POSIX separators. */
  relFile: string;
  data: unknown;
}

/** A lossless YAML location, independent of the legacy dotted display strings. */
export interface SourceLocator {
  /** Path relative to the model root, POSIX separators. */
  relFile: string;
  /** Raw mapping keys and numeric sequence indices; declarations include `id` or `x-model-id`. */
  path: Array<string | number>;
  /** Select the value, or the map entry's key at this path. */
  target: "value" | "key";
}

export interface ReferenceFindings {
  goalRelations: { errors: Array<{ file: string; path: string; message: string }>; warnings: Array<{ file: string; path: string; message: string }> };
  /**
   * `suggestions` are the declared ids that differ from `value` only by a prefix (the shared
   * did-you-mean rule): a hint for the refusal, never a resolution. Empty when there is none.
   */
  missing: Array<{ value: string; loc: string; file: string; suggestions: string[]; source: SourceLocator }>;
  /** `sources` identifies every identity property in the same order as `locations`. */
  duplicates: Array<{ id: string; locations: string[]; sources: SourceLocator[] }>;
  /** Each ring in walk order, rotated to its lowest member. */
  parentCycles: string[][];
  selfEdges: Array<{ id: string; key: string; arm: string; loc: string; file: string }>;
  /** A service nested under one party whose `system_ref` names another; both resolve and contradict. */
  envelopeConflicts: Array<{ service: string; declared: string; envelope: string; loc: string; file: string }>;
  /** An id spelled with a band this schema line still accepts and no longer wants, once per declaration. */
  retiredBands: Array<{ id: string; band: RetiredBand; rebanded: string; loc: string; file: string }>;
}

/** What a schema line says about the space some nested ids are unique in. */
export interface IdSpaces {
  /** A concept attribute (`CAT`) is unique within its bounded context rather than across the model. */
  attributesPerContext: boolean;
}

/** The id spaces a schema line declares, read off its `attribute_ref` - see cross-references.mjs. */
export function deriveIdSpaces(registry: Map<string, unknown>): IdSpaces;

/** Resolve every reference the documents make against every id they declare - see cross-references.mjs. */
export function resolveModelReferences(
  documents: ModelDocument[],
  refKeys: ReferenceKeys,
  bandTable?: RetiredBandTable,
  declaredBands?: unknown[],
  idSpaces?: IdSpaces,
): ReferenceFindings;
