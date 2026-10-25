/**
 * A process declares an end state no activity of the process is attached to.
 *
 * An end state names the activities that lead to it in `from`. The model builder reads the
 * attachments once and writes them on the process as `_ends`, one entry per declared end state
 * with the activities that lead to it in `from`: where any end state states `from`, each end
 * state's own list, copied as written; otherwise the end convention, where the process declares
 * exactly one `complete` end state, attaches the last listed main-path activity with no
 * successor, or, where every main-path activity has a successor, the last listed main-path
 * activity whose stated links all go to `error` or `compensation` activities; every other end
 * state has an empty `from`. This rule reads those entries, so it and every drawing read the same
 * attachment.
 *
 * An id in `from` attaches only where it names exactly one activity of this process, the test
 * the process graph applies before it draws a flow to the end event. An end state none of whose
 * ids does is reported with those ids, so a mistyped id, or one of another process's activities,
 * says why the end state is unattached. An end state with at least one such id is attached.
 *
 * `_ends` is derived only on the v2.8 line and only for a process that lists activities, so the
 * rule is silent on an older line and on a process with no activities: there is no attachment to
 * read there, and guessing one here would let the rule and the drawings disagree.
 *
 * One finding per process, naming every unattached end state and its type, because the engine
 * emits one issue per subject and the subject is the process.
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function processEndStateUnattached(_model, subject) {
  const data = recordOf(recordOf(subject).data);
  const ends = data._ends;
  if (!Array.isArray(ends)) return { ok: true };

  // How many activities of this process carry each id: an id attaches where it names exactly one.
  const activityCount = new Map();
  for (const activity of Array.isArray(data.activities) ? data.activities : []) {
    const id = recordOf(activity).id;
    if (typeof id === 'string' && id) activityCount.set(id, (activityCount.get(id) ?? 0) + 1);
  }
  const resolvesHere = (/** @type {unknown} */ id) => typeof id === 'string' && activityCount.get(id) === 1;

  const unattached = [];
  for (const entry of ends) {
    const end = recordOf(entry);
    if (typeof end.name !== 'string' || !end.name) continue;
    const from = Array.isArray(end.from) ? end.from : [];
    if (from.some(resolvesHere)) continue;
    const type = typeof end.type === 'string' && end.type ? end.type : 'no type';
    const named = from.filter((id) => typeof id === 'string' && id);
    unattached.push(
      named.length > 0 ?
        `${end.name} (${type}; its from names no activity of this process: ${named.join(', ')})`
      : `${end.name} (${type})`,
    );
  }
  if (unattached.length === 0) return { ok: true };

  return { ok: false, context: { count: unattached.length, end_states: unattached.join('; ') } };
}
