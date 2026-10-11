// @ts-check
/**
 * How a blueprint model's non-functional requirements are read: one reader per field, the
 * classification of a requirement, and the measurement state of a metric.
 *
 * A caller that reads a requirement, a metric or a fitness function through these functions does not
 * restate a field's name or its meaning.
 *
 * Two model shapes are accepted, because two kinds of caller hold a model:
 *
 *   - the checker's model, where a relation carries `source` and `target`;
 *   - the built blueprint model, where a relation carries `source_entity_id` and `target_entity_id`.
 *
 * In both, an entity carries its declared fields under `data`, and a relation's endpoints are entity
 * `id`s. A reader takes an entity; a function that follows a relation also takes the model, and
 * returns entities of that model, so a caller keeps its own entity type. Nothing here builds a
 * relation: what links a requirement to its metric, or a fitness function to what it verifies, is
 * read from the relations the model already holds. A relation that ends at an entity of another type
 * than the field names, or at no declared entity (the model builder's placeholder for a reference
 * that does not resolve), links nothing.
 *
 * The model holds no measured values. A metric says whether it is measured, by which instrument and
 * where its results are kept; an objective states a level to reach. Nothing here reads a result or
 * a date.
 */

/** The NFR relation types, as the model graph names them. */
export const NFR_RELATION_TYPES = Object.freeze(
  /** @type {const} */ ({
    sloMetric: 'slo_metric',
    kpiMetric: 'kpi_metric',
    slaSlo: 'sla_slo',
    fitnessFunctionVerifies: 'fitness_function_verifies',
    fitnessFunctionMetric: 'fitness_function_metric',
    metricProbe: 'metric_probe',
    metricWorkItem: 'metric_work_item',
  }),
);

/** The entity types this module reads, as the model graph names them. */
export const NFR_ENTITY_TYPES = Object.freeze(
  /** @type {const} */ ({
    metric: 'Metric',
    kpi: 'KPI',
    slo: 'SLO',
    sla: 'SLA',
    security: 'Security',
    compliance: 'Compliance',
    resilience: 'Resilience',
    fitnessFunction: 'FitnessFunction',
    goal: 'Goal',
    probe: 'Probe',
    workItem: 'WorkItem',
  }),
);

/**
 * The lists of `fitness_function.verifies`, keyed by the entity type each one holds. An SLA has no
 * list of its own: a fitness function guards an SLA through its SLOs.
 */
export const VERIFIES_ARM_BY_TYPE = Object.freeze(
  /** @type {const} */ ({
    SLO: 'slos',
    KPI: 'kpis',
    Security: 'security',
    Compliance: 'compliance',
    Resilience: 'resilience',
    Goal: 'goals',
  }),
);

/** The lists of `fitness_function.verifies`, in declaration order. */
export const VERIFIES_ARMS = Object.freeze(
  /** @type {const} */ (['slos', 'kpis', 'security', 'compliance', 'resilience', 'goals']),
);

/** The comparators an objective may use. */
export const OBJECTIVE_COMPARATORS = Object.freeze(/** @type {const} */ (['lt', 'le', 'gt', 'ge', 'eq']));

/**
 * The measurement states of a metric. The first three are the values `metric.collection.status`
 * may state; `unstated` is a metric that states none, which is a gap in the model and is never
 * read as `measured`.
 */
export const MEASUREMENT_STATUSES = Object.freeze(
  /** @type {const} */ (['measured', 'not-measured', 'no-instrument', 'unstated']),
);

/**
 * The classes of a requirement:
 *
 *   - `measurable`: an SLO or KPI that names a metric and states an `objective`, so a result of
 *     that metric can be compared with a level;
 *   - `stated-without-measure`: an SLO or KPI that lacks a metric, an objective or both, and every
 *     security, compliance and resilience requirement;
 *   - `constraint`: a fitness function that carries a `quality_characteristic`, a quality
 *     constraint in its own right and its own verification.
 */
export const REQUIREMENT_CLASSES = Object.freeze(
  /** @type {const} */ (['measurable', 'stated-without-measure', 'constraint']),
);

/**
 * What would move a requirement stated without a measure forward:
 *
 *   - `metric`: an SLO or KPI with an objective and no metric; name the metric;
 *   - `objective`: an SLO or KPI with a metric and no objective; state the objective;
 *   - `metric-and-objective`: an SLO or KPI with neither;
 *   - `guard`: a security, compliance or resilience requirement; a fitness function that verifies
 *     it, never a metric.
 */
export const REQUIREMENT_REMEDIES = Object.freeze(
  /** @type {const} */ (['metric', 'objective', 'metric-and-objective', 'guard']),
);

/**
 * @typedef {{ id: string, type: string, displayId?: string, data?: Record<string, unknown> | null }} NfrEntity
 * @typedef {{ type: string, source?: string, target?: string, source_entity_id?: string, target_entity_id?: string }} NfrRelation
 * @typedef {'slos' | 'kpis' | 'security' | 'compliance' | 'resilience' | 'goals'} VerifiesArm
 * @typedef {Record<VerifiesArm, string[]>} Verifies
 * @typedef {'lt' | 'le' | 'gt' | 'ge' | 'eq'} Comparator
 * @typedef {{ comparator: Comparator, value: number, statistic: string | null }} Objective
 * @typedef {{ discoveryStage: string | null, certainty: string | null, evidence: unknown[] }} Provenance
 * @typedef {{ characteristic: string | null, subcharacteristic: string | null }} Characteristic
 * @typedef {{ status: string | null, probeRef: string | null, workItemRef: string | null, resultsLocation: string | null }} Measurement
 * @typedef {'measured' | 'not-measured' | 'no-instrument' | 'unstated'} MeasurementStatus
 * @typedef {{ status: MeasurementStatus, probe: string | null, workItem: string | null, resultsLocator: string | null }} MeasurementState
 * @typedef {'measurable' | 'stated-without-measure' | 'constraint'} RequirementClass
 * @typedef {'metric' | 'objective' | 'metric-and-objective' | 'guard'} RequirementRemedy
 * @typedef {{ class: RequirementClass, remedy: RequirementRemedy | null }} Classification
 */

/**
 * A model: its entities and its relations. `E` is the caller's entity type, which the functions
 * that follow a relation return.
 *
 * @template {NfrEntity} [E=NfrEntity]
 * @typedef {{ entities?: readonly E[], relations?: readonly NfrRelation[] }} NfrModel
 */

// ---------------------------------------------------------------------------------------------
// Readers: one per declared field, each taking an entity that carries `data`
// ---------------------------------------------------------------------------------------------

/**
 * `fitness_function.verifies`: what a fitness function protects, one list per kind. Every list is
 * present in the result, empty when the model states none; null when the entity states no
 * `verifies` at all.
 *
 * The ids are returned as stated, in declared order, a repeated id repeated, and are not resolved:
 * an id that names no entity is returned like any other. `verifiedBy` reads the same links from the
 * other end, through the relations the model resolved.
 *
 * @param {NfrEntity} entity
 * @returns {Verifies | null}
 */
export function readVerifies(entity) {
  const verifies = objectAt(entity, 'verifies');
  if (!verifies) return null;
  /** @type {Verifies} */
  const result = { slos: [], kpis: [], security: [], compliance: [], resilience: [], goals: [] };
  for (const arm of VERIFIES_ARMS) result[arm] = stringsIn(verifies[arm]);
  return result;
}

/**
 * `fitness_function.metric`: the one measure a fitness function's assertion is evaluated on, as
 * the id the model states; null when it states none.
 *
 * @param {NfrEntity} entity
 * @returns {string | null}
 */
export function readFfMetric(entity) {
  return nonEmptyString(dataOf(entity).metric);
}

/**
 * `objective` on an SLO or KPI: the level it sets for its metric. Null when none is stated, or when
 * what is stated is not a comparable level (an unknown comparator, a value that is not a number),
 * since a reader cannot compare a result with it.
 *
 * @param {NfrEntity} entity
 * @returns {Objective | null}
 */
export function readObjective(entity) {
  const objective = objectAt(entity, 'objective');
  if (!objective) return null;
  const comparator = objective.comparator;
  const value = objective.value;
  if (typeof comparator !== 'string' || !isComparator(comparator)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return { comparator, value, statistic: nonEmptyString(objective.statistic) };
}

/**
 * `provenance`: how settled an entity is and on what evidence. `evidence` is the list as stated,
 * empty when none is. Null when the entity states no provenance.
 *
 * @param {NfrEntity} entity
 * @returns {Provenance | null}
 */
export function readProvenance(entity) {
  const provenance = objectAt(entity, 'provenance');
  if (!provenance) return null;
  return {
    discoveryStage: nonEmptyString(provenance.discovery_stage),
    certainty: nonEmptyString(provenance.certainty),
    evidence: Array.isArray(provenance.evidence) ? [...provenance.evidence] : [],
  };
}

/**
 * `quality_characteristic` and `quality_subcharacteristic` as the entity itself states them. They
 * are declared on a metric, a finding and a fitness function; an SLO or KPI serves the
 * characteristic of its metric, which a caller reads by reading the metric. Null when the entity
 * states neither.
 *
 * @param {NfrEntity} entity
 * @returns {Characteristic | null}
 */
export function readCharacteristic(entity) {
  const data = dataOf(entity);
  const characteristic = nonEmptyString(data.quality_characteristic);
  const subcharacteristic = nonEmptyString(data.quality_subcharacteristic);
  if (characteristic === null && subcharacteristic === null) return null;
  return { characteristic, subcharacteristic };
}

/**
 * `metric.collection`'s measurement members as stated: `status`, `probe_ref`, `work_item_ref`,
 * `results_location`. A member the model does not state is null. Null when the metric states no
 * `collection`.
 *
 * @param {NfrEntity} entity
 * @returns {Measurement | null}
 */
export function readMeasurement(entity) {
  const collection = objectAt(entity, 'collection');
  if (!collection) return null;
  return {
    status: nonEmptyString(collection.status),
    probeRef: nonEmptyString(collection.probe_ref),
    workItemRef: nonEmptyString(collection.work_item_ref),
    resultsLocation: nonEmptyString(collection.results_location),
  };
}

// ---------------------------------------------------------------------------------------------
// Measurement state of a metric
// ---------------------------------------------------------------------------------------------

/**
 * A metric's measurement state: its status, the instrument that measures it (`probe`), the work
 * that builds or acquires one (`workItem`) and where its results are kept (`resultsLocator`).
 * A metric that states no status, or a status outside the declared values, is `unstated`: a gap in
 * the model, never read as `measured`.
 *
 * `probe` is the `collection.probe_ref` the metric states, and only when that reference reaches a
 * probe of `model` (its `metric_probe` relation, as `metricProbe` reads it). A `probe_ref` that
 * names no declared entity, or an entity of another type, is no instrument, so `probe` is null for
 * it, as it is for a metric that states none. `workItem` is read the same way: the
 * `collection.work_item_ref` the metric states, only when it reaches a work item of `model` (its
 * `metric_work_item` relation, as `metricWorkItem` reads it). Without a model nothing can be
 * resolved and both are null. `resultsLocator` is returned as stated. `readMeasurement` returns
 * every member as stated, unresolved.
 *
 * @param {NfrEntity} metric
 * @param {NfrModel} [model]
 * @returns {MeasurementState}
 */
export function measurementState(metric, model) {
  const measurement = readMeasurement(metric);
  const stated = measurement?.status ?? null;
  /** @type {MeasurementStatus} */
  const status = stated !== null && isMeasurementStatus(stated) ? stated : 'unstated';
  const probeRef = measurement?.probeRef ?? null;
  const probeResolves = probeRef !== null && model !== undefined && metricProbe(metric, model) !== null;
  const workItemRef = measurement?.workItemRef ?? null;
  const workItemResolves = workItemRef !== null && model !== undefined && metricWorkItem(metric, model) !== null;
  return {
    status,
    probe: probeResolves ? probeRef : null,
    workItem: workItemResolves ? workItemRef : null,
    resultsLocator: measurement?.resultsLocation ?? null,
  };
}

/**
 * Whether a measurement state asks for an instrument to be built or acquired. Only `no-instrument`
 * does: a `not-measured` metric has an instrument that nobody runs, which is a gap in the model,
 * not an instrument need.
 *
 * @param {MeasurementState} state
 * @returns {boolean}
 */
export function isInstrumentNeed(state) {
  return state.status === 'no-instrument';
}

// ---------------------------------------------------------------------------------------------
// Readers that follow a relation the model holds
// ---------------------------------------------------------------------------------------------

/**
 * The metric an SLO or KPI is stated on, read from its `slo_metric` or `kpi_metric` relation. Null
 * for any other entity type, for one that names no metric, and for one whose `metric` does not
 * resolve to a metric of the model: a reference no entity declares, or one that names an entity of
 * another type.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} entity
 * @param {NfrModel<E>} model
 * @returns {E | null}
 */
export function requirementMetric(entity, model) {
  const relationType =
    entity.type === NFR_ENTITY_TYPES.slo
      ? NFR_RELATION_TYPES.sloMetric
      : entity.type === NFR_ENTITY_TYPES.kpi
        ? NFR_RELATION_TYPES.kpiMetric
        : null;
  if (relationType === null) return null;
  return outgoingOfType(entity, model, relationType, NFR_ENTITY_TYPES.metric)[0] ?? null;
}

/**
 * The entities that declare the id an SLO's or KPI's `metric` names, when more than one does. Such
 * a reference is ambiguous: the model builder points its `slo_metric` / `kpi_metric` relation at a
 * placeholder that lists the candidates, so it links none of them and `requirementMetric` returns
 * null. An id is its whole string, so the reference names one of them only once their declared ids
 * differ. Empty for any other entity type, and for a `metric` that names one entity or none.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} entity
 * @param {NfrModel<E>} model
 * @returns {E[]}
 */
export function requirementMetricCandidates(entity, model) {
  const relationType =
    entity.type === NFR_ENTITY_TYPES.slo
      ? NFR_RELATION_TYPES.sloMetric
      : entity.type === NFR_ENTITY_TYPES.kpi
        ? NFR_RELATION_TYPES.kpiMetric
        : null;
  if (relationType === null) return [];
  const graph = indexOf(model);
  for (const target of graph.outgoing.get(relationType)?.get(entity.id) ?? []) {
    const data = dataOf(/** @type {NfrEntity} */ (graph.byId.get(target)));
    if (data.ambiguous !== true || !Array.isArray(data.candidates)) continue;
    const ids = data.candidates.filter((candidate) => typeof candidate === 'string');
    return /** @type {E[]} */ (ids.map((id) => graph.byId.get(id)).filter((found) => found !== undefined));
  }
  return [];
}

/**
 * The probe a metric is measured by, read from its `metric_probe` relation (`collection.probe_ref`).
 * Null for any other entity type, for a metric that names no probe, and for one whose `probe_ref`
 * does not resolve to a probe of the model: a reference no entity declares, one more than one
 * entity declares, or one that names an entity of another type.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} metric
 * @param {NfrModel<E>} model
 * @returns {E | null}
 */
export function metricProbe(metric, model) {
  if (metric.type !== NFR_ENTITY_TYPES.metric) return null;
  return outgoingOfType(metric, model, NFR_RELATION_TYPES.metricProbe, NFR_ENTITY_TYPES.probe)[0] ?? null;
}

/**
 * The work item that builds or acquires a metric's instrument, read from its `metric_work_item`
 * relation (`collection.work_item_ref`). Null for any other entity type, for a metric that names no
 * work item, and for one whose `work_item_ref` does not resolve to a work item of the model: a
 * reference no entity declares, one more than one entity declares, or one that names an entity of
 * another type.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} metric
 * @param {NfrModel<E>} model
 * @returns {E | null}
 */
export function metricWorkItem(metric, model) {
  if (metric.type !== NFR_ENTITY_TYPES.metric) return null;
  return outgoingOfType(metric, model, NFR_RELATION_TYPES.metricWorkItem, NFR_ENTITY_TYPES.workItem)[0] ?? null;
}

/**
 * The metric a fitness function's assertion is evaluated on, read from its
 * `fitness_function_metric` relation. Null for any other entity type, for a fitness function that
 * names no metric, and for one whose `metric` does not resolve to a metric of the model.
 * `readFfMetric` returns the same field's id as stated.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} entity
 * @param {NfrModel<E>} model
 * @returns {E | null}
 */
export function fitnessFunctionMetric(entity, model) {
  if (entity.type !== NFR_ENTITY_TYPES.fitnessFunction) return null;
  return outgoingOfType(entity, model, NFR_RELATION_TYPES.fitnessFunctionMetric, NFR_ENTITY_TYPES.metric)[0] ?? null;
}

/**
 * The SLOs an SLA is made of, read from its `sla_slo` relations, each once, in the order `sla.slos`
 * declares them. An id in `sla.slos` that does not resolve to an SLO of the model is left out, so a
 * caller that reports unresolved ids compares this list with the field as stated. Empty for any
 * other entity type and for an SLA that names no SLO.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} entity
 * @param {NfrModel<E>} model
 * @returns {E[]}
 */
export function slaSlos(entity, model) {
  if (entity.type !== NFR_ENTITY_TYPES.sla) return [];
  return outgoingOfType(entity, model, NFR_RELATION_TYPES.slaSlo, NFR_ENTITY_TYPES.slo);
}

/**
 * The fitness functions that verify an entity, read from incoming `fitness_function_verifies`
 * relations: entities of the model, each once, ordered by the id the model declares (`displayId`,
 * or the entity `id` where none is carried), then by entity `id`, in code-unit order. Empty when
 * nothing verifies it.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} entity
 * @param {NfrModel<E>} model
 * @returns {E[]}
 */
export function verifiedBy(entity, model) {
  const graph = indexOf(model);
  const sources = graph.incoming.get(NFR_RELATION_TYPES.fitnessFunctionVerifies)?.get(entity.id) ?? [];
  const functions = /** @type {E[]} */ (entitiesOfType(graph, sources, NFR_ENTITY_TYPES.fitnessFunction));
  return functions.sort(
    (a, b) => byCodeUnit(declaredIdOf(a), declaredIdOf(b)) || byCodeUnit(a.id, b.id),
  );
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

/**
 * The class of a requirement, and for one stated without a measure what would move it forward.
 *
 *   - An SLO or KPI is `measurable` when it names a metric of the model (its `slo_metric` /
 *     `kpi_metric` relation, as `requirementMetric` reads it) and states a comparable `objective`; otherwise it is `stated-without-measure`,
 *     with remedy `metric`, `objective` or `metric-and-objective` naming what is missing.
 *   - A security, compliance or resilience requirement is `stated-without-measure` with remedy
 *     `guard`: a fitness function that verifies it.
 *   - A fitness function with a `quality_characteristic` is a `constraint`.
 *
 * Null for everything else: a metric; an SLA, which is read through its SLOs; a fitness function
 * with no quality characteristic, which guards requirements rather than stating one.
 *
 * @param {NfrEntity} entity
 * @param {NfrModel} model
 * @returns {Classification | null}
 */
export function classifyRequirement(entity, model) {
  switch (entity.type) {
    case NFR_ENTITY_TYPES.slo:
    case NFR_ENTITY_TYPES.kpi: {
      const hasMetric = requirementMetric(entity, model) !== null;
      const hasObjective = readObjective(entity) !== null;
      if (hasMetric && hasObjective) return { class: 'measurable', remedy: null };
      /** @type {RequirementRemedy} */
      const remedy = hasMetric ? 'objective' : hasObjective ? 'metric' : 'metric-and-objective';
      return { class: 'stated-without-measure', remedy };
    }
    case NFR_ENTITY_TYPES.security:
    case NFR_ENTITY_TYPES.compliance:
    case NFR_ENTITY_TYPES.resilience:
      return { class: 'stated-without-measure', remedy: 'guard' };
    case NFR_ENTITY_TYPES.fitnessFunction:
      return readCharacteristic(entity)?.characteristic ? { class: 'constraint', remedy: null } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

/**
 * The model's index, keyed by its relations array (by its entities array, or the model itself,
 * when it has none), so two model objects that share their arrays share one index. An entry is
 * reused only while the model carries the same two arrays at the same lengths; an array grown or
 * shrunk in place is indexed again. An element replaced in place, at an unchanged length, is not
 * seen.
 *
 * @type {WeakMap<object, {
 *   entities: readonly NfrEntity[] | undefined,
 *   relations: readonly NfrRelation[] | undefined,
 *   entityCount: number,
 *   relationCount: number,
 *   index: { byId: Map<string, NfrEntity>, outgoing: Map<string, Map<string, string[]>>, incoming: Map<string, Map<string, string[]>> },
 * }>}
 */
const indexCache = new WeakMap();

/**
 * The model's entities by id and its relations by type and endpoint, each endpoint list in the
 * model's relation order.
 *
 * @param {NfrModel} model
 * @returns {{ byId: Map<string, NfrEntity>, outgoing: Map<string, Map<string, string[]>>, incoming: Map<string, Map<string, string[]>> }}
 */
function indexOf(model) {
  const { entities, relations } = model;
  const entityCount = entities?.length ?? 0;
  const relationCount = relations?.length ?? 0;
  const key = relations ?? entities ?? model;
  const cached = indexCache.get(key);
  if (
    cached &&
    cached.entities === entities &&
    cached.relations === relations &&
    cached.entityCount === entityCount &&
    cached.relationCount === relationCount
  ) {
    return cached.index;
  }
  /** @type {Map<string, NfrEntity>} */
  const byId = new Map();
  for (const entity of entities ?? []) byId.set(entity.id, entity);
  /** @type {Map<string, Map<string, string[]>>} */
  const outgoing = new Map();
  /** @type {Map<string, Map<string, string[]>>} */
  const incoming = new Map();
  for (const relation of relations ?? []) {
    const source = relation.source ?? relation.source_entity_id;
    const target = relation.target ?? relation.target_entity_id;
    if (typeof source !== 'string' || typeof target !== 'string') continue;
    push(outgoing, relation.type, source, target);
    push(incoming, relation.type, target, source);
  }
  const index = { byId, outgoing, incoming };
  indexCache.set(key, { entities, relations, entityCount, relationCount, index });
  return index;
}

/**
 * The targets of an entity's outgoing relations of one type that are entities of the model of one
 * type, each once, in relation order.
 *
 * @template {NfrEntity} E
 * @param {NfrEntity} entity
 * @param {NfrModel<E>} model
 * @param {string} relationType
 * @param {string} targetType
 * @returns {E[]}
 */
function outgoingOfType(entity, model, relationType, targetType) {
  const graph = indexOf(model);
  const targets = graph.outgoing.get(relationType)?.get(entity.id) ?? [];
  return /** @type {E[]} */ (entitiesOfType(graph, targets, targetType));
}

/**
 * The entities of one type among `ids`, each once, in the order of `ids`. An id that names no
 * entity, or an entity of another type, is left out.
 *
 * @param {{ byId: Map<string, NfrEntity> }} graph
 * @param {readonly string[]} ids
 * @param {string} type
 * @returns {NfrEntity[]}
 */
function entitiesOfType(graph, ids, type) {
  /** @type {NfrEntity[]} */
  const found = [];
  const seen = new Set();
  for (const id of ids) {
    const entity = graph.byId.get(id);
    if (!entity || entity.type !== type || seen.has(id)) continue;
    seen.add(id);
    found.push(entity);
  }
  return found;
}

/**
 * @param {NfrEntity} entity
 * @returns {string}
 */
function declaredIdOf(entity) {
  return typeof entity.displayId === 'string' && entity.displayId.length > 0 ? entity.displayId : entity.id;
}

/**
 * @param {Map<string, Map<string, string[]>>} byType
 * @param {string} type
 * @param {string} key
 * @param {string} value
 */
function push(byType, type, key, value) {
  let byKey = byType.get(type);
  if (!byKey) {
    byKey = new Map();
    byType.set(type, byKey);
  }
  const values = byKey.get(key);
  if (values) values.push(value);
  else byKey.set(key, [value]);
}

/**
 * @param {NfrEntity} entity
 * @returns {Record<string, unknown>}
 */
function dataOf(entity) {
  const data = entity?.data;
  return data !== null && typeof data === 'object' ? data : {};
}

/**
 * @param {NfrEntity} entity
 * @param {string} key
 * @returns {Record<string, unknown> | null}
 */
function objectAt(entity, key) {
  const value = dataOf(entity)[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringsIn(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0) : [];
}

/**
 * @param {string} value
 * @returns {value is Comparator}
 */
function isComparator(value) {
  return /** @type {readonly string[]} */ (OBJECTIVE_COMPARATORS).includes(value);
}

/**
 * @param {string} value
 * @returns {value is MeasurementStatus}
 */
function isMeasurementStatus(value) {
  return /** @type {readonly string[]} */ (MEASUREMENT_STATUSES).includes(value);
}

/**
 * @param {string} a
 * @param {string} b
 */
function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
