// @ts-check
/**
 * An element marked `as-is` that names no code or infrastructure-as-code saying where it is.
 *
 * Two reference roles say something other than where an existing element lives. A reference whose
 * `role` is `planned` points at the place the element is to be built: the element is not in it yet.
 * One whose `role` is `gap` points at code that shows the element is absent, such as the handler
 * that accepts input without the check. Neither is evidence for `as-is`. An element is satisfied by
 * at least one code or iac reference whose role is anything else, including no role at all; one
 * whose references are all planned or gap is reported the same as one with none.
 */

import { PLANNED_ROLE } from './implementation-to-be-with-code-refs.mjs';

/** The `role` value that marks a reference as code showing the element is absent. */
export const GAP_ROLE = 'gap';

/** Roles whose references say nothing about where an existing element lives. */
const NOT_EVIDENCE = new Set([PLANNED_ROLE, GAP_ROLE]);

/** @param {unknown} value @returns {Array<Record<string, unknown>>} */
function referencesIn(value) {
  return Array.isArray(value) ? value.filter((reference) => reference && typeof reference === 'object') : [];
}

/**
 * Satisfied when one of the element's code or iac references is neither planned nor gap.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function asIsWithoutCodeRefs(_model, subject) {
  const data = subject && typeof subject === 'object' && subject.data && typeof subject.data === 'object'
    ? /** @type {Record<string, unknown>} */ (subject.data)
    : {};
  const references = [...referencesIn(data.code_refs), ...referencesIn(data.iac_refs)];
  if (references.some((reference) => !NOT_EVIDENCE.has(/** @type {string} */ (reference.role)))) return { ok: true };
  const reason = references.length === 0
    ? 'names no code_refs or iac_refs'
    : `names only ${references.length} reference(s) with role planned or gap, which say where it is to be built or that it is absent, not where it is`;
  return { ok: false, context: { reason } };
}
