import type { ReferenceKeys } from "./reference-keys.mjs";

/** `RT###` refs point to the resource-type catalog in the profiles, never into the model. */
export const CATALOG_REF_RE: RegExp;

export interface ModelDocument {
  /** Path relative to the model root, POSIX separators. */
  relFile: string;
  data: unknown;
}

export interface ReferenceFindings {
  missing: Array<{ value: string; loc: string; file: string }>;
  duplicates: Array<{ id: string; locations: string[] }>;
  /** Each ring in walk order, rotated to its lowest member. */
  parentCycles: string[][];
  selfEdges: Array<{ id: string; key: string; arm: string; loc: string; file: string }>;
}

/** Resolve every reference the documents make against every id they declare - see cross-references.mjs. */
export function resolveModelReferences(documents: ModelDocument[], refKeys: ReferenceKeys): ReferenceFindings;
