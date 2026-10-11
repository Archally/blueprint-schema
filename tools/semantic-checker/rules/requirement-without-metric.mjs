// @ts-check
/**
 * An SLO or KPI that names no metric of the model.
 *
 * A service level objective or a key performance indicator is judged by a metric: the metric says
 * what is measured, and the requirement's `objective` says which level of it is required. One that
 * names no metric is stated without a measure, so no result could ever be compared with it.
 *
 * THE METRIC IS READ THROUGH THE NFR ACCESSOR, NOT FROM "A RELATION EXISTS". The model builder draws
 * an `slo_metric` / `kpi_metric` edge for every `metric` the requirement states, including one that
 * names no declared entity, one that more than one entity declares (the edge then ends at a
 * placeholder, which lists the candidates when there are several) and one that names an entity of
 * another type. None of them links a metric, so `requirementMetric` returns null for each, and this
 * check agrees with `classifyRequirement`: a requirement this rule reports is never classified
 * `measurable`.
 *
 * The message says which case it is, because the fixes differ. A missing metric is named in
 * `metric`; a reference to nothing, or to something else, is corrected. An ambiguous reference
 * cannot be corrected in the requirement alone: an id is its whole string, so writing a scope
 * prefix in `metric` names a different id rather than one of the declarations. The declarations
 * have to be given ids of their own first.
 *
 * One export serves both rules; the rule file's `find` chooses SLOs or KPIs. The message is built
 * here, whole, because its remedy depends on the case.
 */

import { NFR_ENTITY_TYPES, requirementMetric, requirementMetricCandidates } from './nfr-fields.mjs';

/** @param {any} model @param {any} subject */
export const requirementWithoutMetric = (model, subject) => {
  if (subject?.type !== NFR_ENTITY_TYPES.slo && subject?.type !== NFR_ENTITY_TYPES.kpi) return { ok: true };
  if (requirementMetric(subject, model) !== null) return { ok: true };

  const kind = subject.type === NFR_ENTITY_TYPES.slo ? 'SLO' : 'KPI';
  const consequence = 'so the model does not say what is measured to judge it';
  const remedy = `Name its metric in \`metric\`; with an \`objective\` beside it the ${kind} is measurable.`;
  const raw = subject?.data?.metric;
  const stated = typeof raw === 'string' ? raw.trim() : '';

  /** @type {string} */
  let finding;
  if (stated.length === 0) {
    finding = `names no metric, ${consequence}. ${remedy}`;
  } else {
    const candidates = requirementMetricCandidates(subject, model);
    finding =
      candidates.length > 1
        ? `names metric "${stated}", which ${candidates.length} entities of the model declare, so it names none of them and the model does not say what is measured to judge it. Give the metric it means an id no other entity declares, for example with its slice as a scope prefix, then name that id in \`metric\`.`
        : `names metric "${stated}", which is not a metric of the model, ${consequence}. ${remedy}`;
  }
  return { ok: false, context: { finding } };
};
