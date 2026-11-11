/** Work-process checks read authored facts. Missing references belong to validation. */
const records = (value) => Array.isArray(value)
  ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];

/** Resolve exact declared ids only; ambiguous declarations are never selected. */
function resolveEntity(model, reference, type) {
  if (typeof reference !== 'string') {
    return undefined;
  }
  const matches = (model.entities ?? []).filter((entity) => entity.type === type
    && [entity.id, entity.displayId, entity.data?.id].includes(reference));
  return matches.length === 1 ? matches[0] : undefined;
}

function result(problems) {
  return problems.length > 0
    ? { ok: false, context: { problems: problems.join('; ') } } : { ok: true };
}

/** @type {import('@archally/semantic-checker').CustomRuleFunction} */
export function laneTeamDiffersFromStaffing(model, subject) {
  const problems = [];
  for (const [position, lane] of records(subject.data?.lanes).entries()) {
    const actor = resolveEntity(model, lane.actor, 'Actor');
    const team = resolveEntity(model, lane.team, 'Team');
    const staffing = resolveEntity(model, actor?.data?.staffed_by, 'Team');
    if (team && staffing && team.id !== staffing.id) {
      problems.push(`lanes[${position}]: actor ${lane.actor} is staffed by ${actor.data.staffed_by}, lane names ${lane.team}`);
    }
  }
  return result(problems);
}

/** Membership counts distinct lane declarations, never repeated items within one lane. */
function memberships(data) {
  const membership = new Map();
  for (const [position, lane] of records(data?.lanes).entries()) {
    for (const reference of new Set(Array.isArray(lane.activities) ? lane.activities : [])) {
      const positions = membership.get(reference) ?? [];
      positions.push(position);
      membership.set(reference, positions);
    }
  }
  return membership;
}

/** @type {import('@archally/semantic-checker').CustomRuleFunction} */
export function activityInTwoLanes(_model, subject) {
  const activities = new Set(records(subject.data?.activities).map((activity) => activity.id));
  return result([...memberships(subject.data)].filter(([reference, positions]) => activities.has(reference) && positions.length > 1)
    .map(([reference, positions]) => `${reference} in lanes ${positions.join(', ')}`));
}

/** The projection places explicit activities, then the entry/first operation, then an actor. */
function placedByFallback(model, activity, lanes) {
  const entry = resolveEntity(model, activity.entry_operation, 'Operation');
  const firstOperation = entry ?? records(activity.steps)
    .map((step) => resolveEntity(model, step.operation_ref, 'Operation')).find(Boolean);
  if (firstOperation && lanes.some((lane) => (lane.operations ?? []).some((reference) =>
    resolveEntity(model, reference, 'Operation')?.id === firstOperation.id))) {
    return true;
  }
  return (activity.triggered_by ?? []).some((reference) => resolveEntity(model, reference, 'Actor'));
}

/** @type {import('@archally/semantic-checker').CustomRuleFunction} */
export function workActivityWithoutLane(model, subject) {
  if (subject.data?.describes !== 'organization') {
    return { ok: true };
  }
  const membership = memberships(subject.data);
  const lanes = records(subject.data?.lanes);
  return result(records(subject.data?.activities)
    // Ambiguous membership has its own warning, not a second missing-lane advisory.
    .filter((activity) => !membership.has(activity.id) && !placedByFallback(model, activity, lanes))
    .map((activity) => String(activity.id ?? activity.name ?? '(unnamed activity)')));
}

/** @type {import('@archally/semantic-checker').CustomRuleFunction} */
export function activityToolPartyNotSystem(model, subject) {
  const problems = [];
  for (const activity of records(subject.data?.activities)) {
    for (const [position, tool] of records(activity.tools).entries()) {
      const party = resolveEntity(model, tool.party, 'Party');
      if (party && party.data?.kind !== 'system') {
        problems.push(`${activity.id}: tools[${position}].party ${tool.party} has kind ${party.data?.kind ?? '(unstated)'}`);
      }
    }
  }
  return result(problems);
}
