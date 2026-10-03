/** The kinds of finding `classifyModelFiles` reports. */
export const FILE_FINDING: Readonly<{
  notInModel: "file-not-in-model";
  retired: "retired-file-name";
  rootPlacement: "root-document-placement";
}>;

/** A file the author would want to hear about: outside the model by its name, or misplaced in it. */
export interface FileFinding {
  kind: string;
  /** Path relative to the model root, POSIX separators. */
  file: string;
  message: string;
}

export interface Membership {
  /** The files the model builder loads: checked, and the source of declarations and references. */
  modelFiles: string[];
  /** Every other file: neither checked nor counted. */
  outsideFiles: string[];
  findings: FileFinding[];
}

/** The layer a name looks like it holds although the builder does not load it; null otherwise. */
export function nearMissLayer(
  fileName: string,
): { layer: string; stem: string; separator: string; extension: string } | null;

/** Sort the files of a model directory into the model and the rest, with a finding per file worth one. */
export function classifyModelFiles(relFiles: string[], options?: { singleFile?: boolean }): Membership;
