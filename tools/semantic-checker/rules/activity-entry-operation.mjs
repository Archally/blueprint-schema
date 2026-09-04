/**
 * A story activity that names no `entry_operation`.
 *
 * `entry_operation` is where an activity enters the domain's causal chain, and the story
 * visualizer follows `produces` / `reacts_to` from it. From v2.8 the field is optional, so an
 * author whose operation is not yet modelled can leave the activity honest rather than point it at
 * an id nothing declares - a dangling reference is a cross-reference error, and an invented one is
 * worse than a warning. This rule is the other half of that: absence is reported, so a story does
 * not quietly stop reaching the domain.
 *
 * Activities are not entities - the model builder keeps them on the story's `data.activities` as
 * the schema wrote them - so the subject is the story and the check reads its activities.
 */

/** @param {unknown} entity @returns {Array<Record<string, unknown>>} */
function activitiesOf(entity) {
  const data = entity && typeof entity === 'object' ? /** @type {Record<string, unknown>} */ (entity).data : null;
  const activities = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data).activities : null;
  return Array.isArray(activities)
    ? activities.filter((activity) => activity && typeof activity === 'object')
    : [];
}

/**
 * Satisfied when every activity of the story names an `entry_operation`; otherwise reports the
 * activities that do not, by id or name.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function activityWithoutEntryOperation(_model, subject) {
  const missing = activitiesOf(subject)
    .filter((activity) => typeof activity.entry_operation !== 'string' || activity.entry_operation.length === 0)
    .map((activity) => String(activity.id ?? activity.name ?? '(unnamed activity)'));
  if (missing.length === 0) return { ok: true };
  return { ok: false, context: { count: String(missing.length), activities: missing } };
}
