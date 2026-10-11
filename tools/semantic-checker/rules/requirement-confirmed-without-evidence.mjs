// @ts-check
/**
 * A quality requirement marked `provenance.certainty: confirmed` that cites no evidence.
 *
 * `confirmed` claims the requirement is established, which is a claim about evidence; one made
 * with an empty `provenance.evidence` asserts something the model never sourced, so a reader cannot
 * tell an agreed requirement from an assumption that hardened. Only `certainty` is read:
 * `discovery_stage` is a workflow position, and a `committed` requirement may honestly be an
 * unsourced bet.
 *
 * The subjects are the quality shapes that carry `provenance` (metric, KPI, SLO, SLA, security,
 * compliance and resilience requirements) and a fitness function that states a quality constraint
 * of its own, which `classifyRequirement` names `constraint`. A fitness function that only guards
 * other requirements is not a requirement, so its provenance is not judged here.
 *
 * This is a custom check rather than a field filter because the fitness-function case depends on
 * the requirement classification, which lives in the NFR accessor and is read from there.
 */

import { NFR_ENTITY_TYPES, classifyRequirement, readProvenance } from './nfr-fields.mjs';

/** The quality shapes judged here, each with the words a message names it by. */
const QUALITY_SHAPES = new Map([
  [NFR_ENTITY_TYPES.metric, 'Metric'],
  [NFR_ENTITY_TYPES.kpi, 'KPI'],
  [NFR_ENTITY_TYPES.slo, 'SLO'],
  [NFR_ENTITY_TYPES.sla, 'SLA'],
  [NFR_ENTITY_TYPES.security, 'Security requirement'],
  [NFR_ENTITY_TYPES.compliance, 'Compliance requirement'],
  [NFR_ENTITY_TYPES.resilience, 'Resilience requirement'],
]);

/** @param {any} model @param {any} subject */
export const requirementConfirmedWithoutEvidence = (model, subject) => {
  const provenance = readProvenance(subject);
  if (provenance?.certainty !== 'confirmed') return { ok: true };
  if (provenance.evidence.length > 0) return { ok: true };

  if (subject.type === NFR_ENTITY_TYPES.fitnessFunction) {
    if (classifyRequirement(subject, model)?.class !== 'constraint') return { ok: true };
  } else if (!QUALITY_SHAPES.has(subject.type)) {
    return { ok: true };
  }
  return { ok: false, context: { kind: QUALITY_SHAPES.get(subject.type) ?? 'Fitness function' } };
};
