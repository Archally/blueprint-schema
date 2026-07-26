// @ts-check
/**
 * Content heuristics (plan D20) — the difference between "a field is present" and
 * "a field says something".
 *
 * A presence-only gate is gameable by construction: an agent optimizing a red/green
 * loop emits `description: "The criteria field."` and the gate goes green while the
 * downstream OpenAPI viewer is no better off. These checks are deterministic (no LLM)
 * and deliberately conservative — they catch the cheapest gaming, not all of it.
 *
 * Every observation resolves to exactly one status:
 *   missing — the field is absent or blank
 *   filler  — present but fails a content heuristic (counts against the metric)
 *   covered — present and substantive
 */

/**
 * Words that carry no meaning when deciding whether a description echoes its subject.
 *
 * Three groups, and the third is the one that matters:
 *   1. grammar — articles, copulas, prepositions
 *   2. structural nouns — "field", "property", "value"
 *   3. **entity-kind nouns** — "event", "command", "rule", "payload", "status"…
 *
 * Group 3 was added 2026-07-25 after a dry run: `description: "The residual transferred event."`
 * on an event named `Residual Transferred` scored as COVERED, because the word "event" was a word
 * the subject did not contain and so counted as new meaning. Naming the entity's own kind is the
 * single most natural way to pad an echo, which made it the widest hole in the check.
 *
 * Adding a word here can only make the check STRICTER (an echo needs every significant word to
 * already appear in the subject, so removing words from consideration makes echoes easier to
 * detect). The risk is therefore false positives — which is what the FALSE POSITIVE GUARD case in
 * heuristics.test.mjs exists to bound. Keep this list to words that describe the *model*, not the
 * *domain*.
 */
const STOP_WORDS = new Set([
  // 1. grammar
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'being', 'been',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as',
  'it', 'its', 'and', 'or',
  // 2. structural nouns
  'field', 'fields', 'property', 'properties', 'attribute', 'attributes',
  'value', 'values', 'object', 'entity', 'item', 'items',
  'holds', 'contains', 'represents', 'stores', 'indicates', 'specifies',
  // 3. entity-kind and meta nouns — naming what a thing IS says nothing about what it means
  'event', 'events', 'command', 'commands', 'operation', 'operations',
  'query', 'queries', 'rule', 'rules', 'decision', 'decisions',
  'risk', 'risks', 'story', 'stories', 'concept', 'concepts', 'actor', 'actors',
  'model', 'models', 'schema', 'schemas', 'payload', 'payloads',
  'request', 'requests', 'response', 'responses', 'record', 'records',
  'identifier', 'identifiers', 'data', 'info', 'information', 'detail', 'details',
  'flag', 'flags', 'list', 'lists', 'name', 'names', 'description', 'descriptions',
  'type', 'types', 'status', 'state', 'step', 'steps', 'case', 'cases', 'test', 'tests',
]);

/**
 * Split an identifier into its constituent words.
 * `payGapReason` / `pay_gap_reason` / `pay-gap-reason` → ['pay','gap','reason'].
 * @param {string} identifier
 * @returns {string[]}
 */
export function splitIdentifier(identifier) {
  return String(identifier)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')   // HTTPStatus  → HTTP Status
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')      // payGap      → pay Gap
    .replace(/([A-Za-z])(\d)/g, '$1 $2')         // status2     → status 2
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/**
 * Reduce prose to its meaning-bearing words, so that surface differences
 * (case, punctuation, articles, "field") don't hide an echo.
 * @param {string} text
 * @returns {string[]}
 */
export function significantWords(text) {
  return splitIdentifier(text).filter((word) => !STOP_WORDS.has(word));
}

/**
 * True when `text` says nothing beyond restating `subject`.
 *
 * "The criteria field."          vs subject `criteria`      → true  (echo)
 * "Criteria"                     vs subject `criteria`      → true  (echo)
 * "Pay gap reason"               vs subject `payGapReason`  → true  (echo)
 * "Ranked factors justifying …"  vs subject `criteria`      → false (real)
 *
 * @param {string} text
 * @param {string} subject
 * @returns {boolean}
 */
export function echoesSubject(text, subject) {
  if (!subject) return false;
  const textWords = significantWords(text);
  if (textWords.length === 0) return true; // nothing but stop-words is never a description
  const subjectWords = new Set(significantWords(subject));
  if (subjectWords.size === 0) return false;
  // An echo adds no word the subject didn't already contain.
  return textWords.every((word) => subjectWords.has(word));
}

/**
 * Evaluate one collected value against a metric's content rules.
 *
 * @param {unknown} value                      the collected field value
 * @param {object} [contentRules]              metric.content from the spec
 * @param {number} [contentRules.min_length]
 * @param {string[]} [contentRules.deny]       literal placeholder strings (case-insensitive)
 * @param {string[]} [contentRules.deny_echo_of] context keys whose value must not be echoed
 * @param {Record<string,string>} [context]    e.g. { name: 'criteria', title: 'PayGapPayload' }
 * @returns {{status: 'covered'|'filler'|'missing', reason?: string}}
 */
export function classifyValue(value, contentRules, context = {}) {
  const isNonEmptyList = Array.isArray(value) && value.length > 0;
  const isNonBlankText = typeof value === 'string' && value.trim().length > 0;
  // Strings are judged ONLY by isNonBlankText — a whitespace-only value is absent,
  // not present-but-odd. Non-strings fall through to a plain presence check.
  const isPresentNonString = value !== undefined && value !== null
    && typeof value !== 'string' && !Array.isArray(value);

  if (!isNonEmptyList && !isNonBlankText && !isPresentNonString) {
    return { status: 'missing' };
  }
  // Non-text values (arrays, numbers, booleans, objects) carry no prose to inspect.
  if (!isNonBlankText || !contentRules) {
    return { status: 'covered' };
  }

  const text = value.trim();

  const denyList = contentRules.deny ?? [];
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const placeholder of denyList) {
    if (normalized === String(placeholder).toLowerCase().replace(/[^a-z0-9]/g, '')) {
      return { status: 'filler', reason: `placeholder "${text}"` };
    }
  }

  if (contentRules.min_length && text.length < contentRules.min_length) {
    return { status: 'filler', reason: `too short (${text.length} < ${contentRules.min_length} chars)` };
  }

  for (const contextKey of contentRules.deny_echo_of ?? []) {
    const subject = context[contextKey];
    if (subject && echoesSubject(text, subject)) {
      return { status: 'filler', reason: `restates ${contextKey} "${subject}"` };
    }
  }

  return { status: 'covered' };
}
