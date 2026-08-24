// @ts-check
/**
 * Slice scoping — the vertical counterpart to `--since` patch scoping.
 *
 * A brownfield model is enriched one architectural slice at a time (payroll, then
 * recruitment, then employees, …), so the gate needs a way to measure and ratchet a
 * SINGLE slice as its own unit — its own whole-model score and its own baseline —
 * independently of git history. `--since` answers "is the work I just committed good
 * enough?"; `--slice` answers "is this whole slice at its steady-state bar yet?".
 *
 * A slice is simply the first path segment under the model root:
 *   <modelRoot>/payroll/payroll.domain.yaml   → slice "payroll"
 *   <modelRoot>/fitness.test-cases.yaml       → slice ROOT_SLICE (files in the root)
 * That matches how these models are laid out on disk — one folder per slice, plus a
 * handful of cross-cutting files directly in the root.
 */

import path from 'node:path';

/** Synthetic slice name for files that sit directly in the model root, not in a folder. */
export const ROOT_SLICE = '(root)';

/**
 * The slice an absolute file path belongs to, relative to `modelRoot`.
 * @param {string} modelRoot absolute model root
 * @param {string} absoluteFile absolute path of a file under the root
 * @returns {string} slice name, or {@link ROOT_SLICE} for root-level files
 */
export function sliceOf(modelRoot, absoluteFile) {
  const relative = path.relative(modelRoot, absoluteFile);
  const [head, ...rest] = relative.split(path.sep);
  return rest.length === 0 ? ROOT_SLICE : head;
}

/**
 * Normalize a user-supplied `--slice` argument to a comparable slice name. Accepts a
 * bare folder name (`payroll`), a trailing-slash form (`payroll/`), or the root
 * sentinel spelled in any case.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSliceArg(raw) {
  const trimmed = String(raw).trim().replace(/[\\/]+$/, '');
  if (trimmed === '' || trimmed === '.' || trimmed.toLowerCase() === ROOT_SLICE) return ROOT_SLICE;
  // A path-like argument (payroll/payroll.domain.yaml) still resolves to its first segment.
  const [head] = trimmed.split(/[\\/]/);
  return head;
}

/**
 * The slices that actually carry measurable content, sorted.
 *
 * Derived from the observations rather than from the directory listing, because the
 * question a caller needs answered is "did `--slice X` select anything the gate can
 * score?" — a folder holding no measurable YAML answers that no, exactly as a
 * misspelled name does.
 * @param {{slice?: string}[]} observations
 * @returns {string[]}
 */
export function observedSlices(observations) {
  return [...new Set(observations.map((observation) => observation.slice).filter(Boolean))].sort();
}
