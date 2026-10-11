// @ts-check
/**
 * An SLO or KPI that names a metric of the model and states no comparable objective.
 *
 * A requirement is measurable when a result of its metric can be compared with a level: the metric
 * says what is measured, the `objective` says which level is required. One that names its metric and
 * states no objective says what to measure and not what counts as meeting it, so no result could
 * ever be judged against it. A prose `target` is not a level a reader can compare a result with.
 *
 * The subject is read through the NFR accessor's `classifyRequirement`: an SLO or KPI is reported
 * exactly when its remedy is `objective`, so this check and the classification never disagree. That
 * leaves the other cases to the rules that name them, each reported once:
 *
 *   - no metric of the model, with or without an objective: `slo-without-metric` and
 *     `kpi-without-metric` (their message already says an objective goes beside the metric);
 *   - a metric and a comparable objective: measurable, and `objective-without-measurement` reports
 *     it when the metric does not say it is measured by an instrument.
 *
 * Two findings, because the fixes differ. An objective that is not stated is written; one that is
 * stated and is not a comparable level (a comparator outside lt, le, gt, ge and eq, or a value that
 * is not a number) is corrected. The schema rejects the second as well; it is reported here too, so
 * every SLO or KPI whose remedy is `objective` has a finding that names it.
 */

import { NFR_ENTITY_TYPES, classifyRequirement, requirementMetric } from './nfr-fields.mjs';

/** @param {any} entity */
const labelOf = (entity) => entity?.displayId ?? entity?.data?.id ?? entity?.id ?? '?';

/** @param {any} model @param {any} subject */
export const requirementWithoutObjective = (model, subject) => {
  if (subject?.type !== NFR_ENTITY_TYPES.slo && subject?.type !== NFR_ENTITY_TYPES.kpi) return { ok: true };
  if (classifyRequirement(subject, model)?.remedy !== 'objective') return { ok: true };

  const named = `metric "${labelOf(requirementMetric(subject, model))}"`;
  const stated = subject?.data?.objective;
  const statesObjective = stated !== undefined && stated !== null;
  const finding = statesObjective
    ? `names ${named} and states an objective that is not a comparable level, so no result of the metric can be compared with it. Correct it: objective.comparator is one of lt, le, gt, ge or eq, and objective.value is a number in the unit of the metric.`
    : `names ${named} and states no objective, so no result of the metric can be compared with a level it requires. State one in objective: comparator (lt, le, gt, ge or eq), value (a number in the unit of the metric) and, optionally, statistic (for example p95).`;
  return {
    ok: false,
    context: { kind: subject.type === NFR_ENTITY_TYPES.slo ? 'SLO' : 'KPI', finding },
  };
};
