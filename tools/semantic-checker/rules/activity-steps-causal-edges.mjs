/**
 * The seam between an activity's `steps` and the domain's causal links.
 *
 * `steps` states the ORDER operations run in inside one activity of one story; `produces` and
 * `reacts_to` state CAUSALITY, true of an operation wherever it appears. The two are written
 * independently and agree where they overlap, so two adjacent steps can stand in three relations
 * to the causal graph:
 *
 *   forward  - the first produces the second, or produces an event the second reacts to, or the
 *              second reacts to the first: the order restates a declared edge;
 *   reverse  - the SECOND produces the FIRST (directly or through an event the first reacts to),
 *              or the first reacts to the second: the order contradicts a declared edge, and the
 *              two statements cannot both be true;
 *   none     - no declared edge joins them: a person acted next, or a read ran, and the causal
 *              graph has nothing to say about that by design.
 *
 * Two rules read this once. `activityStepsReverseCausalEdge` reports the reverse pairs; a pair
 * that is both forward and reverse (a cycle the model declares) is not a contradiction of the
 * order and is left alone. `activityStepsWithoutCausalEdge` counts the pairs no edge joins, so a
 * reader can see how much of a story's sequence the causal graph carries and how much only the
 * steps do.
 *
 * A step's reference is resolved through the story's own `operationsDetail`, which the model
 * builder writes from the same list and relation building resolves against the real entities. A
 * step naming an operation nothing declares is skipped here: that is a cross-reference finding,
 * not a statement about order.
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOf(value) {
  return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {unknown} value @returns {Array<Record<string, unknown>>} */
function recordsOf(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

/**
 * Each activity's step references resolved to entity ids, in order. An activity with fewer than
 * two resolved steps contributes no pair.
 *
 * @param {unknown} subject
 * @returns {Array<{ activityId: string; steps: Array<{ ref: string; id: string } | undefined> }>}
 */
function resolvedActivities(subject) {
  const data = recordOf(recordOf(subject).data);
  const resolvedByRef = new Map();
  for (const detail of recordsOf(data.operationsDetail)) {
    if (detail.resolved === true && typeof detail.operationRef === 'string' && typeof detail.resolvedEntityId === 'string') {
      resolvedByRef.set(detail.operationRef, detail.resolvedEntityId);
    }
  }
  const activities = [];
  for (const activity of recordsOf(data.activities)) {
    // An unresolved step keeps its place as `undefined`, so the pairs formed below are the pairs
    // the author wrote. Dropping it would make its two neighbours adjacent and report an order
    // nobody stated.
    const steps = recordsOf(activity.steps).map((step) => {
      const ref = typeof step.operation_ref === 'string' ? step.operation_ref : undefined;
      const id = ref ? resolvedByRef.get(ref) : undefined;
      return ref && id ? { ref, id } : undefined;
    });
    if (steps.length > 1) activities.push({ activityId: String(activity.id ?? activity.name ?? '?'), steps });
  }
  return activities;
}

/**
 * The declared causal edges as two maps: `produces` (source -> targets) and `reactsTo`
 * (reactor -> the events it reacts to). Both relation spellings are read, `source` / `target` and
 * `source_entity_id` / `target_entity_id`, so the rule holds whichever model hands it relations.
 *
 * @param {{ relations?: unknown[] }} model
 */
function causalEdges(model) {
  const produces = new Map();
  const reactsTo = new Map();
  const add = (map, from, to) => {
    if (typeof from !== 'string' || typeof to !== 'string') return;
    if (!map.has(from)) map.set(from, new Set());
    map.get(from).add(to);
  };
  for (const relation of recordsOf(model.relations)) {
    const from = relation.source ?? relation.source_entity_id;
    const to = relation.target ?? relation.target_entity_id;
    if (relation.type === 'produces') add(produces, from, to);
    else if (relation.type === 'reacts_to') add(reactsTo, from, to);
  }
  const has = (map, from, to) => map.get(from)?.has(to) === true;
  /** `a` leads to `b`: directly, through an event `b` reacts to, or because `b` reacts to `a`. */
  const forward = (a, b) => {
    if (has(produces, a, b) || has(reactsTo, b, a)) return true;
    for (const event of produces.get(a) ?? []) if (has(reactsTo, b, event)) return true;
    return false;
  };
  return { forward };
}

/**
 * @param {import('@archally/semantic-checker').CheckableModel} model
 * @param {unknown} subject
 */
function classifyPairs(model, subject) {
  const { forward } = causalEdges(model);
  const reversed = [];
  let edgeless = 0;
  let pairs = 0;
  for (const activity of resolvedActivities(subject)) {
    for (let index = 1; index < activity.steps.length; index++) {
      const first = activity.steps[index - 1];
      const second = activity.steps[index];
      if (!first || !second || first.id === second.id) continue;
      pairs++;
      const ahead = forward(first.id, second.id);
      const behind = forward(second.id, first.id);
      if (behind && !ahead) reversed.push(`${activity.activityId}: ${first.ref} then ${second.ref}`);
      else if (!ahead && !behind) edgeless++;
    }
  }
  return { reversed, edgeless, pairs };
}

/**
 * Two adjacent steps in the opposite order to a declared causal edge.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function activityStepsReverseCausalEdge(model, subject) {
  const { reversed } = classifyPairs(model, subject);
  if (reversed.length === 0) return { ok: true };
  return { ok: false, context: { count: String(reversed.length), pairs: reversed } };
}

/**
 * How many adjacent steps no declared causal edge joins. Advisory: on a real model this is half of
 * all pairs, and nearly all of them are a person acting next or a read running.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function activityStepsWithoutCausalEdge(model, subject) {
  const { edgeless, pairs } = classifyPairs(model, subject);
  if (edgeless === 0) return { ok: true };
  return { ok: false, context: { count: String(edgeless), pairs: String(pairs) } };
}
