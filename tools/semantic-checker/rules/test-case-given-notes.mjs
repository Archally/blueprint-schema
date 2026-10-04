/**
 * A test case's `given.description` is the one sentence a reader takes as the precondition: the
 * state to set up before the act. This module reports a precondition that carries something else -
 * the code a case was checked against, a review remark, or so much prose that the state is buried in
 * it - because a reader of a test report cannot tell those sentences from the setup. The test case's
 * `note` is where they belong, and the rule's hint says so.
 *
 * THREE SIGNALS, each a deterministic text match, and each deliberately narrow. A false positive
 * here asks an author to move a sentence that was a precondition, so a shape that is also ordinary
 * test data is left out on purpose: a date (an expiry is a precondition), a configuration key in
 * capitals (a setting is a precondition), a typed model id, and a CamelCase name with no code suffix
 * or ending in `Service`, `Manager` or `Provider` (domain language uses those words too).
 *
 *   code        a scope operator between identifiers (`Order::hasInvoice`, `$cart->update`), a file
 *               with a source-code extension (`classes/tax/Tax.php`, `OrderController.cs`), a call
 *               with empty parentheses (`isFloat()`), or a CamelCase name ending in a code-role
 *               suffix (`AddTaxRuleHandler`, `CannotDeleteProductException`).
 *   remark      a dated revision (`Corrected 2026-09-19: ...`), a sentence opening with `Note`, or
 *               a TODO / FIXME / TBD / XXX marker.
 *   length      more than MAX_PRECONDITION_LENGTH characters.
 *
 * WHERE THE LENGTH COMES FROM. A precondition is a state, stated in a sentence or two. The schema
 * caps a test case's one-line `summary` at 200 characters; 250 leaves a precondition a quarter more
 * room than that line, which is two ordinary sentences, and anything longer is explaining the state
 * rather than stating it.
 *
 * WARNING, NOT ERROR. The model is valid either way, and the text may be right where it is in a
 * model nobody reads as a test plan. The rule reports; the author decides.
 */

/** Characters a precondition may hold before it is reported. Derivation in the header. */
export const MAX_PRECONDITION_LENGTH = 250;

const SOURCE_EXTENSIONS =
  'php|ts|tsx|js|jsx|mjs|cjs|java|kt|cs|vb|fs|py|rb|go|rs|scala|swift|cpp|cc|h|hpp|cshtml|razor|twig|tpl|vue|svelte';

/** Library names that end in `.js` and name a technology, not a file. */
const LIBRARY_NAMES = /\b(?:Node|Vue|Next|Nuxt|Express|Angular|D3|Three|Chart|Ember)\.js\b/g;

const CODE_PATTERNS = [
  /\w(?:::|->)\w/,
  new RegExp(`\\b[\\w./-]+\\.(?:${SOURCE_EXTENSIONS})\\b`),
  /\b[A-Za-z_]\w*\(\)/,
  /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*(?:Handler|Controller|Repository|Factory|Validator|Listener|Subscriber|Middleware|Exception|Dto|DTO|Command|Query)\b/,
];

const REMARK_PATTERNS = [
  /\b(?:corrected|reviewed|revised|updated|changed|fixed|verified)\b[^.]{0,20}\b\d{4}-\d{2}-\d{2}\b/i,
  /(?:^|[.;!?]\s+|\()\s*(?:note|nb)\b/i,
  /\b(?:TODO|FIXME|TBD|XXX)\b/,
];

/**
 * What a precondition carries besides the state, as a list of reasons, or an empty list.
 * @param {string} text
 * @returns {string[]}
 */
export function preconditionFindings(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const reasons = [];
  const codeText = text.replace(LIBRARY_NAMES, '');
  if (CODE_PATTERNS.some((pattern) => pattern.test(codeText))) reasons.push('names code');
  if (REMARK_PATTERNS.some((pattern) => pattern.test(text))) reasons.push('carries a review remark');
  if (text.length > MAX_PRECONDITION_LENGTH) {
    reasons.push(`runs to ${text.length} characters (more than ${MAX_PRECONDITION_LENGTH})`);
  }
  return reasons;
}

const labelOf = (entity) => entity?.data?.id ?? entity?.displayId ?? entity?.id ?? '?';

/** A test case whose precondition carries code, a review remark, or more than a precondition's length. */
export const testCaseGivenCarriesNotes = (model, subject) => {
  const reasons = preconditionFindings(subject?.data?.given?.description);
  if (reasons.length === 0) return { ok: true };
  const joined = reasons.length === 1
    ? reasons[0]
    : `${reasons.slice(0, -1).join(', ')} and ${reasons.at(-1)}`;
  return {
    ok: false,
    context: {
      subject: labelOf(subject),
      subject_name: subject?.data?.name ?? subject?.name ?? subject?.displayId ?? '',
      reasons: joined,
    },
  };
};
