// @ts-check
/**
 * An SLO or KPI with an objective whose metric does not say it is measured by an instrument.
 *
 * A requirement that names a metric and states an `objective` is measurable: a result of the metric
 * could be compared with the objective. Whether such a result exists is stated on the metric, in
 * `collection.status`, `collection.probe_ref` and `collection.work_item_ref`. This check reads those
 * three through the NFR accessor's `measurementState` and never a result or a date: the model holds
 * no measured values. A `probe_ref` counts only when it reaches a probe of the model; one that names
 * no declared entity, or an entity of another type, is no instrument. A `work_item_ref` counts the
 * same way, only when it reaches a work item of the model.
 *
 * Four findings, because they ask for different work, each naming the field that clears it:
 *
 *   - the status is not stated: a gap in the model, never read as measured;
 *   - `measured` with no probe of the model: results exist and nothing says what produces them;
 *     the message says when a `probe_ref` is stated and does not resolve;
 *   - `not-measured`: an instrument exists or could, and nobody measures; a model gap;
 *   - `no-instrument`: an instrument has to be built or acquired, an instrument need, naming the
 *     probe it plans when the metric names one, and the work item that builds it, or saying that
 *     none does or that the `work_item_ref` stated names no single work item of the model.
 *
 * `measured` with a probe of the model says everything this check asks. A requirement with an objective and no
 * metric of the model is not a subject: `slo-without-metric` and `kpi-without-metric` report it, so
 * it is never reported twice. A requirement with no comparable objective is not a subject either.
 */

import {
  NFR_ENTITY_TYPES,
  isInstrumentNeed,
  measurementState,
  readMeasurement,
  readObjective,
  requirementMetric,
} from './nfr-fields.mjs';

/** @param {any} entity */
const labelOf = (entity) => entity?.displayId ?? entity?.data?.id ?? entity?.id ?? '?';

/** @param {any} model @param {any} subject */
export const objectiveWithoutMeasurement = (model, subject) => {
  if (subject?.type !== NFR_ENTITY_TYPES.slo && subject?.type !== NFR_ENTITY_TYPES.kpi) return { ok: true };
  if (readObjective(subject) === null) return { ok: true };
  const metric = requirementMetric(subject, model);
  if (metric === null) return { ok: true };

  const state = measurementState(metric, model);
  const named = `metric "${labelOf(metric)}"`;
  const stated = readMeasurement(metric);
  const statedProbe = stated?.probeRef ?? null;
  const statedWorkItem = stated?.workItemRef ?? null;
  /** @type {string} */
  let finding;
  if (state.status === 'measured') {
    if (state.probe !== null) return { ok: true };
    const instrument =
      statedProbe !== null
        ? `which is stated as measured, but its probe_ref "${statedProbe}" names no single probe of the model`
        : 'which is stated as measured but names no instrument';
    finding = `states an objective on ${named}, ${instrument}: name the probe that produces its results in collection.probe_ref.`;
  } else if (state.status === 'not-measured') {
    const start =
      state.probe !== null
        ? `Start measuring it with probe "${state.probe}", then state measured in collection.status`
        : 'Start measuring it, then state measured in collection.status, the probe that measures it in collection.probe_ref';
    finding = `states an objective on ${named}, which is stated as not measured: a gap in the model. ${start} and where the results are kept in collection.results_location.`;
  } else if (isInstrumentNeed(state)) {
    const build = state.probe !== null ? `build or acquire probe "${state.probe}", the instrument it names` : 'build or acquire one';
    const work =
      state.workItem !== null
        ? `work item "${state.workItem}" builds it`
        : statedWorkItem !== null
          ? `its work_item_ref "${statedWorkItem}" names no single work item of the model: name the work item that builds it in collection.work_item_ref`
          : 'no work item builds it: name one in collection.work_item_ref';
    finding = `states an objective on ${named}, which has no measuring instrument: ${build}; ${work}.`;
  } else {
    finding = `states an objective, but its ${named} does not say whether it is measured: state measured, not-measured or no-instrument in collection.status.`;
  }
  return {
    ok: false,
    context: { kind: subject.type === NFR_ENTITY_TYPES.slo ? 'SLO' : 'KPI', finding },
  };
};
