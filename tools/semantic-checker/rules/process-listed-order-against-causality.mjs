/**
 * A process whose order is read from its list, where the model's own causality reads otherwise.
 *
 * On the v2.8 line a process's activities run in the order they are listed unless a main-path
 * activity states a main-path successor. The model builder writes that order as `_next` branches
 * whose `origin` is `declared-order`, so a process carries such a branch exactly when list order is
 * its order. That is the only kind of process this rule reads: a process that states its links
 * has said what it means, and on an older line no branch is read from the list.
 *
 * Two shapes say the list may not be a sequence, both read from what the model states elsewhere:
 *
 *   (i)  a main-path activity is `triggered_by` an event that a LATER-listed main-path activity
 *        produces, and no earlier-listed main-path activity produces it. List order puts the
 *        reaction before its cause.
 *   (ii) two neighbouring main-path activities are `triggered_by` the same event. Two reactions to
 *        one event are a fork or alternatives, and the list chains them one after the other.
 *
 * An activity produces an event when it runs an operation (its `entry_operation` or a step's
 * `operation_ref`) that `produces` the event, or when it runs the event itself. Actor entries in
 * `triggered_by` start an activity rather than cause it, so they are not compared. A reference is
 * compared by the entity it names, as written, under the process's own scope, or by its bare id
 * where one entity carries it; a reference that names none is compared as written.
 *
 * A heuristic, so a warning and never an error: it reports where list order may be the wrong
 * reading, and the fix is a stated `next` (with a `gateway` where the activities branch), which
 * also takes the process out of this rule's reach. One finding per process, naming every pair,
 * because the engine emits one issue per subject and the subject is the process.
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** An activity whose `path_type` is absent or `happy` is on the main path. */
function onMainPath(activity) {
  const pathType = activity.path_type;
  return pathType === undefined || pathType === null || pathType === '' || pathType === 'happy';
}

const ACTOR_REF = /(^|\.)ACT\d+$/;

/**
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function processListedOrderAgainstCausality(model, subject) {
  const data = recordOf(recordOf(subject).data);
  const activities = Array.isArray(data.activities) ? data.activities.map(recordOf) : [];
  const listOrdered = activities.some(
    (activity) => Array.isArray(activity._next) && activity._next.some((branch) => recordOf(branch).origin === 'declared-order'),
  );
  if (!listOrdered) return { ok: true };

  const main = activities.filter((activity) => onMainPath(activity) && typeof activity.id === 'string' && activity.id);
  if (main.length < 2) return { ok: true };

  const entities = Array.isArray(model?.entities) ? model.entities : [];
  /** @type {Map<string, any>} */
  const byDisplay = new Map();
  /** @type {Map<string, number>} */
  const bareCount = new Map();
  for (const entity of entities) {
    if (!entity || entity.type === 'Missing' || typeof entity.displayId !== 'string' || !entity.displayId) continue;
    if (!byDisplay.has(entity.displayId)) byDisplay.set(entity.displayId, entity);
    const dot = entity.displayId.indexOf('.');
    const bare = dot > 0 ? entity.displayId.slice(dot + 1) : entity.displayId;
    bareCount.set(bare, (bareCount.get(bare) ?? 0) + 1);
  }
  /** @type {Map<string, any>} */
  const byBare = new Map();
  for (const entity of entities) {
    if (!entity || entity.type === 'Missing' || typeof entity.displayId !== 'string' || !entity.displayId) continue;
    const dot = entity.displayId.indexOf('.');
    const bare = dot > 0 ? entity.displayId.slice(dot + 1) : entity.displayId;
    if (bareCount.get(bare) === 1) byBare.set(bare, entity);
  }
  const scope = typeof data.scope === 'string' && data.scope ? data.scope : undefined;

  /** The entity a reference names, or undefined. */
  const resolve = (ref) => {
    if (typeof ref !== 'string' || !ref) return undefined;
    const direct = byDisplay.get(ref);
    if (direct) return direct;
    const dot = ref.indexOf('.');
    if (dot < 0 && scope) {
      const scoped = byDisplay.get(`${scope}.${ref}`);
      if (scoped) return scoped;
    }
    return byBare.get(dot > 0 ? ref.slice(dot + 1) : ref);
  };
  /** A comparable key and a printable label for a reference. */
  const keyOf = (ref) => {
    const entity = resolve(ref);
    return entity ? { key: String(entity.id), label: String(entity.displayId) } : { key: `ref:${ref}`, label: String(ref) };
  };

  /** @type {Map<string, Set<string>>} operation entity id -> event entity ids it produces */
  const producesOf = new Map();
  for (const relation of Array.isArray(model?.relations) ? model.relations : []) {
    if (!relation || relation.type !== 'produces') continue;
    const source = relation.source ?? relation.source_entity_id;
    const target = relation.target ?? relation.target_entity_id;
    if (typeof source !== 'string' || typeof target !== 'string') continue;
    if (!producesOf.has(source)) producesOf.set(source, new Set());
    producesOf.get(source)?.add(target);
  }

  /** The events an activity produces, as keys. */
  const produced = (activity) => {
    const refs = [activity.entry_operation];
    if (Array.isArray(activity.steps)) for (const step of activity.steps) refs.push(recordOf(step).operation_ref);
    const keys = new Set();
    for (const ref of refs) {
      if (typeof ref !== 'string' || !ref) continue;
      const entity = resolve(ref);
      if (!entity) continue;
      if (recordOf(entity.data).kind === 'event') keys.add(String(entity.id));
      for (const event of producesOf.get(String(entity.id)) ?? []) keys.add(event);
    }
    return keys;
  };
  /** The events an activity is triggered by, as keys with labels. */
  const triggers = (activity) => {
    const out = new Map();
    if (!Array.isArray(activity.triggered_by)) return out;
    for (const ref of activity.triggered_by) {
      if (typeof ref !== 'string' || !ref || ACTOR_REF.test(ref)) continue;
      const entity = resolve(ref);
      if (entity && entity.type !== 'Operation') continue;
      const { key, label } = keyOf(ref);
      out.set(key, label);
    }
    return out;
  };

  const producedBy = main.map(produced);
  const triggeredBy = main.map(triggers);
  const findings = [];

  // (i) a reaction listed before its only cause.
  main.forEach((activity, index) => {
    for (const [event, label] of triggeredBy[index]) {
      if (producedBy.slice(0, index).some((keys) => keys.has(event))) continue;
      const later = main.findIndex((_, other) => other > index && producedBy[other].has(event));
      if (later < 0) continue;
      findings.push(`${activity.id} reacts to ${label}, which the later ${main[later].id} produces`);
    }
  });

  // (ii) two neighbours reacting to one event.
  for (let index = 0; index + 1 < main.length; index++) {
    const shared = [...triggeredBy[index]].filter(([event]) => triggeredBy[index + 1].has(event)).map(([, label]) => label);
    if (shared.length > 0) findings.push(`${main[index].id} and ${main[index + 1].id} both react to ${shared.join(', ')}`);
  }

  if (findings.length === 0) return { ok: true };
  return { ok: false, context: { count: findings.length, findings: findings.join('; ') } };
}
