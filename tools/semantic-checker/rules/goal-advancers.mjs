/**
 * The kinds of entity whose field says it works toward a goal, in the order a reader meets them:
 * the business's abilities and flows, then the interventions and the plan that deliver them, then the
 * decisions taken for them, then the design elements a goal motivated.
 */
export const ADVANCER_KINDS = /** @type {const} */ ([
  'capability', 'value_stream', 'leverage_point', 'milestone', 'work_item', 'decision', 'screen', 'question',
]);
/** @typedef {(typeof ADVANCER_KINDS)[number]} AdvancerKind */

/** Where each kind states its goals: the entity type and the field path inside its data. */
/** @type {Record<AdvancerKind, { type: string; path: readonly string[]; schema: string }>} */
export const ADVANCER_FIELDS = {
  capability: { type: 'Capability', path: ['goal_refs'], schema: 'capability.goal_refs' },
  value_stream: { type: 'ValueStream', path: ['goal_refs'], schema: 'value_stream.goal_refs' },
  leverage_point: { type: 'LeveragePoint', path: ['advances_goals'], schema: 'leverage_point.advances_goals' },
  milestone: { type: 'Milestone', path: ['advances_goals'], schema: 'milestone.advances_goals' },
  work_item: { type: 'WorkItem', path: ['advances_goals'], schema: 'work_item.advances_goals' },
  decision: { type: 'Decision', path: ['motivation_refs', 'goals'], schema: 'motivation_links.goals' },
  screen: { type: 'Screen', path: ['motivated_by'], schema: 'screen.motivated_by' },
  question: { type: 'Question', path: ['motivated_by'], schema: 'question.motivated_by' },
};

/**
 * The default: the six kinds whose field says the entity supports, serves or advances the goal.
 * `screen` and `question` name a goal through `motivated_by` - the goal caused the screen or the
 * question, which is not a claim that either moves the goal forward - so they count only on request.
 */
/** @type {readonly AdvancerKind[]} */
export const DEFAULT_ADVANCED_BY = [
  'capability', 'value_stream', 'leverage_point', 'milestone', 'work_item', 'decision',
];


/** Read a kind's goal references without interpreting their direction or resolving aliases.
 * @param {any} entity
 * @param {AdvancerKind} kind
 * @returns {string[]}
 */
export function readAdvancerGoals(entity, kind) {
  let node = entity.data ?? {};
  for (const key of ADVANCER_FIELDS[kind].path) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return [];
    node = node[key];
  }
  return Array.isArray(node) ? node.filter(value => typeof value === 'string' && value.trim() !== '') : [];
}

/** A goal's advancers, using exact, unambiguous declared goal ids, as the goal map does.
 * @param {{entities: readonly any[]}} model
 * @param {any} goal
 * @returns {Array<{kind: AdvancerKind, entity: any}>}
 */
export function goalAdvancers(model, goal) {
  const id = goal.displayId;
  if (typeof id !== 'string' || model.entities.filter(entity => entity.type === 'Goal' && entity.displayId === id).length !== 1) return [];
  return DEFAULT_ADVANCED_BY.flatMap(kind => model.entities
    .filter(entity => entity.type === ADVANCER_FIELDS[kind].type && readAdvancerGoals(entity, kind).includes(id))
    .map(entity => ({kind, entity})));
}

/** @param {{entities: readonly any[]}} model @param {any} subject */
export function goalNotAdvanced(model, subject) {
  return { ok: goalAdvancers(model, subject).length > 0 };
}
