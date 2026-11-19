/**
 * An unsettled inquiry that was passed on and states no current addressee.
 *
 * `previously_asked_of` lists whom an inquiry was asked of before `asked_of`. An entry there with no
 * `asked_of` beside it says the inquiry left someone and reached nobody the model names. The schema
 * accepts that state, because a source may say "ask someone else" without saying whom; this rule
 * makes it visible. It reads the two fields and `status` only: an addressee is never inferred from
 * `owner`, `owned_by` or `stakeholders`, and no prose is parsed.
 */

/** Statuses that settle an inquiry; an inquiry in one of them needs no addressee. */
const SETTLED = new Set(['resolved', 'closed']);

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * How an addressee reads in a message: its reference, its name beside it, or its name in quotes.
 * @param {unknown} value
 */
function addresseeWord(value) {
  const addressee = asRecord(value);
  if (!addressee) return 'an addressee';
  const ref = [addressee.actor, addressee.team].find((arm) => typeof arm === 'string' && arm !== '');
  const name = typeof addressee.name === 'string' && addressee.name.trim() !== '' ? addressee.name.trim() : undefined;
  if (ref && name) return `${ref} ("${name}")`;
  if (ref) return String(ref);
  if (name) return `"${name}"`;
  return 'an addressee';
}

/** @param {any} _model @param {any} subject */
export const inquiryPassedOnWithoutAddressee = (_model, subject) => {
  if (subject?.type !== 'Inquiry') return { ok: true };
  const data = asRecord(subject.data) ?? {};
  const earlier = Array.isArray(data.previously_asked_of) ? data.previously_asked_of : [];
  if (earlier.length === 0) return { ok: true };
  if (data.asked_of !== undefined && data.asked_of !== null) return { ok: true };
  if (typeof data.status === 'string' && SETTLED.has(data.status)) return { ok: true };
  const last = earlier[earlier.length - 1];
  const by = addresseeWord(asRecord(last)?.asked_of);
  const earlierWord = earlier.length === 1 ? by : `${by}, the last of ${earlier.length} earlier addressees`;
  return { ok: false, context: { earlier: earlierWord } };
};
