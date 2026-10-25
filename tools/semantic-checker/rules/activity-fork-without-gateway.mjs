/**
 * A process activity forks without saying how its branches relate.
 *
 * An activity names its successors in `next` (each entry a `to` and an optional `condition`) or in
 * the older `next_activities` (bare ids). Two or more successors are a fork, and a fork is one of
 * three things: exactly one branch is taken (`xor`), one or more are (`or`), or all of them are
 * (`and`). The successor list cannot say which; only `gateway` on the forking activity does. Without
 * it a renderer, a catalog and a reader each have to guess, and they can guess differently.
 *
 * Successors are read from the model builder's derived `_next` where it is present, so this rule
 * and every renderer count the same branches. Where it is absent the authored keys are read with
 * the same precedence the builder uses: `next` when it is a list, otherwise `next_activities`. A
 * target written twice is one branch, not two.
 *
 * Only the successors the model states are counted. A `_next` branch whose `origin` is
 * `declared-order` is one the builder reads from the order the activities are listed in: beside a
 * stated link to an error or compensation activity it is the default flow of an exclusive split, a
 * kind the model does state, so it never makes a fork here. A branch with no `origin` is stated.
 *
 * One finding per process, naming every forking activity and its successors, because the engine
 * emits one issue per subject and the subject is the process.
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOf(value) {
  return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * The distinct successor ids an activity names.
 *
 * @param {Record<string, unknown>} activity
 * @returns {string[]}
 */
function successorsOf(activity) {
  /** @type {string[]} */
  let targets = [];
  if (Array.isArray(activity._next)) {
    targets = activity._next
      .filter((branch) => recordOf(branch).origin !== 'declared-order')
      .map((branch) => recordOf(branch).to)
      .filter((to) => typeof to === 'string' && to);
  } else if (Array.isArray(activity.next)) {
    targets = activity.next.map((branch) => recordOf(branch).to).filter((to) => typeof to === 'string' && to);
  } else if (Array.isArray(activity.next_activities)) {
    targets = activity.next_activities.filter((to) => typeof to === 'string' && to);
  }
  return [...new Set(targets)];
}

/**
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function activityForkWithoutGateway(_model, subject) {
  const activities = recordOf(recordOf(subject).data).activities;
  if (!Array.isArray(activities)) return { ok: true };

  const forks = [];
  for (const entry of activities) {
    const activity = recordOf(entry);
    const successors = successorsOf(activity);
    if (successors.length < 2) continue;
    const gateway = activity.gateway;
    if (typeof gateway === 'string' && gateway) continue;
    const id = typeof activity.id === 'string' && activity.id ? activity.id : String(activity.name ?? '?');
    forks.push(`${id} -> ${successors.join(', ')}`);
  }
  if (forks.length === 0) return { ok: true };

  return { ok: false, context: { count: forks.length, forks: forks.join('; ') } };
}
