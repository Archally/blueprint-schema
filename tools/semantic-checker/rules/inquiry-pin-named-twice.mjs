/**
 * An inquiry that names one id in `affects.element_refs` and in a kind list beside it. The two
 * mean the same and the model builder draws the pin once, from the kind list; the repeat is
 * reported so each id is named in one place. Compares the ids as written.
 */

/** The kind lists beside `element_refs`, each taking one kind of id with the same meaning. */
export const KIND_LISTS = Object.freeze([
  'operation_refs',
  'concept_refs',
  'process_refs',
  'story_refs',
  'bounded_context_refs',
  'service_refs',
  'package_refs',
  'capability_refs',
  'process_activity_refs',
]);

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

/** @param {any} _model @param {any} subject */
export const inquiryPinNamedTwice = (_model, subject) => {
  const affects = affectsOf(subject);
  if (!affects) return { ok: true };
  const elements = strings(affects.element_refs);
  if (elements.length === 0) return { ok: true };
  const repeated = [];
  const lists = new Set();
  for (const id of elements) {
    const named = KIND_LISTS.filter((list) => strings(affects[list]).includes(id));
    if (named.length === 0) continue;
    repeated.push(id);
    for (const list of named) lists.add(`\`${list}\``);
  }
  if (repeated.length === 0) return { ok: true };
  return { ok: false, context: { ids: repeated.join(', '), lists: [...lists].join(', ') } };
};
