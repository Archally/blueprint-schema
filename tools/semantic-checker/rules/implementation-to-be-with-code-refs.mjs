// @ts-check
/**
 * An element marked `to-be` that names code or infrastructure-as-code.
 *
 * A reference whose `role` is `planned` points at the place the element is to be built: the file
 * exists, the element is not in it yet. An element that names such a place has said, in data, that
 * its references describe where it will go rather than where it already is, so the other references
 * beside it (the code that shows the gap, the source that states the intent) are read as context.
 * An element whose references name no planned place is reported, because nothing in the data then
 * tells a reader whether the code is there.
 */

/** The `role` value that marks a reference as the place an element is to be built. */
export const PLANNED_ROLE = 'planned';

/** @param {unknown} value @returns {Array<Record<string, unknown>>} */
function referencesIn(value) {
  return Array.isArray(value) ? value.filter((reference) => reference && typeof reference === 'object') : [];
}

/**
 * Satisfied when the element names no reference, or when one of its code or iac references has
 * role `planned`.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function toBeWithCodeRefs(_model, subject) {
  const data = subject && typeof subject === 'object' && subject.data && typeof subject.data === 'object'
    ? /** @type {Record<string, unknown>} */ (subject.data)
    : {};
  const references = [...referencesIn(data.code_refs), ...referencesIn(data.iac_refs)];
  if (references.length === 0) return { ok: true };
  if (references.some((reference) => reference.role === PLANNED_ROLE)) return { ok: true };
  return { ok: false, context: { references: String(references.length) } };
}
