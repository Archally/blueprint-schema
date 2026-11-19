/**
 * An inquiry that names its own id in `affects.element_refs`. A pin relates the inquiry to the
 * element it is about; its own id relates nothing, and the model builder draws no edge for it.
 */

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item !== '') : [];
}

/** @param {any} subject */
function affectsOf(subject) {
  if (subject?.type !== 'Inquiry') return null;
  return asRecord(asRecord(subject.data)?.affects);
}

/** @param {any} subject @returns {Set<string>} */
function ownIds(subject) {
  const ids = new Set();
  if (typeof subject?.displayId === 'string') ids.add(subject.displayId);
  const declared = asRecord(subject?.data)?.id;
  if (typeof declared === 'string') ids.add(declared);
  return ids;
}

/** @param {any} _model @param {any} subject */
export const inquiryPinsItself = (_model, subject) => {
  const affects = affectsOf(subject);
  if (!affects) return { ok: true };
  const own = ownIds(subject);
  if (!strings(affects.element_refs).some((id) => own.has(id))) return { ok: true };
  return { ok: false };
};
