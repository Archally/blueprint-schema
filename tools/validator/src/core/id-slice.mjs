// @ts-check
import { collectIds } from "./references.mjs";
import { modelSlices } from "./root-scope.mjs";
import { detectSchemaType } from "./schema-types.mjs";

/**
 * Warn when a declaration names a known slice other than its file's first folder.
 * Root files and unknown prefixes make no slice-placement claim. A migration's added
 * entities are checked against the change's `placement`, else their explicit `_written_in`,
 * never its payload folder; the pieces of a split, the result of a merge and the target of a
 * move are checked against the change's `placement`. Before/after snapshots for other changes
 * are not declarations.
 *
 * @param {Array<{ relFile: string, data: any }>} documents
 * @returns {Array<{ file: string, message: string }>}
 */
export function idSliceWarnings(documents) {
  const slices = modelSlices(documents);
  const warnings = [];
  function check(data, file, writtenIn, sliceOnly, moved) {
    if (typeof writtenIn !== "string") return;
    const normalized = writtenIn.replace(/\\/g, "/");
    const slash = normalized.indexOf("/");
    if (slash <= 0) return;
    const folder = normalized.slice(0, slash);
    collectIds(data, new Map(), new Map(), [], undefined, (id, path) => {
      const dot = id.indexOf(".");
      if (dot <= 0) return;
      const prefix = id.slice(0, dot);
      if (!slices.has(prefix)) return;
      if (prefix === folder) return;
      const entity = path.slice(0, -1).reduce((node, key) => node?.[key], data);
      const name = typeof entity?.name === "string" ? entity.name : "unnamed";
      const where = sliceOnly ? `its placement is slice '${folder}'` : `its file '${normalized}' is in slice '${folder}'`;
      const hint = moved ? " A move keeps the id; rename it in the same group to give it the new slice's prefix." : "";
      warnings.push({
        file,
        message: `ID slice mismatch: [${file}] Entity '${id}' ('${name}') carries the prefix of slice '${prefix}' but ${where}.${hint}`,
      });
    });
  }
  for (const { relFile, data } of documents) {
    if (detectSchemaType(relFile) !== "migration") {
      check(data, relFile, relFile);
      continue;
    }
    const changes = data?.changes?.entities;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const placement = change?.placement && typeof change.placement === "object" ? change.placement : undefined;
      const placedFile = typeof placement?.file === "string" ? placement.file : undefined;
      const placedSlice = typeof placement?.slice === "string" ? placement.slice : undefined;
      const destination = placedFile ?? (placedSlice ? `${placedSlice}/` : undefined);
      const sliceOnly = !placedFile && Boolean(placedSlice);
      if (change?.kind === "add") {
        check(change.after, relFile, destination ?? change.after?._written_in, sliceOnly, false);
      } else if (change?.kind === "split" && Array.isArray(change.after)) {
        check(change.after.filter((piece) => piece?.id !== change.target), relFile, destination, sliceOnly, false);
      } else if (change?.kind === "merge") {
        check(change.after, relFile, destination, sliceOnly, false);
      } else if (change?.kind === "move" && typeof change.target === "string") {
        check({ id: change.target }, relFile, destination, sliceOnly, true);
      }
    }
  }
  return warnings;
}
