// @ts-check
/**
 * A requirement no fitness function verifies.
 *
 * An SLO, KPI, security, compliance or resilience requirement states what the system must achieve;
 * a fitness function that lists it under `verifies` is what checks it. One that nothing lists says
 * what is required and names nothing that guards it. For a security, compliance or resilience
 * requirement that guard is its only verification, since such a requirement has no level of its own
 * to compare a result with.
 *
 * The guards are read with `verifiedBy`, the NFR accessor's reader of incoming
 * `fitness_function_verifies` relations, which counts a fitness function of the model only. A test
 * case that validates the requirement does not count. A fitness function that carries a
 * `quality_characteristic` is a constraint and its own verification, so it is never a subject; an
 * SLA is guarded through its SLOs and is not a subject either.
 */

import { NFR_ENTITY_TYPES, VERIFIES_ARM_BY_TYPE, verifiedBy } from './nfr-fields.mjs';

/** The requirement types a fitness function verifies, with the words a message names each by. */
const SUBJECTS = new Map([
  [NFR_ENTITY_TYPES.slo, 'SLO'],
  [NFR_ENTITY_TYPES.kpi, 'KPI'],
  [NFR_ENTITY_TYPES.security, 'Security requirement'],
  [NFR_ENTITY_TYPES.compliance, 'Compliance requirement'],
  [NFR_ENTITY_TYPES.resilience, 'Resilience requirement'],
]);

/** @param {any} model @param {any} subject */
export const requirementUnverified = (model, subject) => {
  const kind = SUBJECTS.get(subject?.type);
  if (kind === undefined) return { ok: true };
  if (verifiedBy(subject, model).length > 0) return { ok: true };
  return {
    ok: false,
    context: {
      kind,
      arm: VERIFIES_ARM_BY_TYPE[/** @type {keyof typeof VERIFIES_ARM_BY_TYPE} */ (subject.type)],
    },
  };
};
