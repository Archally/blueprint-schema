/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

/** @type {import('@archally/semantic-checker').CustomRuleFunction} */
export function processStarts(model, subject) {
  const data = recordOf(recordOf(subject).data);
  if (data.triggers === undefined || !Array.isArray(data._starts)) {
    return { ok: true };
  }
  const problems = [];
  if (data.trigger !== undefined) {
    problems.push('trigger and triggers are both declared');
  }
  if (!Array.isArray(data.triggers) || data.triggers.length === 0) {
    problems.push('triggers must be a non-empty list');
  }
  const activities = Array.isArray(data.activities) ? data.activities : [];
  const counts = new Map();
  for (const activity of activities) {
    const id = recordOf(activity).id;
    if (typeof id !== 'string') {
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const entities = Array.isArray(recordOf(model).entities) ? model.entities : [];
  for (const [position, attachment] of data._starts.entries()) {
    const start = recordOf(attachment);
    const target = start.to;
    const location = `${start.id} (triggers[${position}].to)`;
    if (typeof target !== 'string' || target.length === 0) {
      problems.push(`${location}: missing or malformed target`);
      continue;
    }
    const count = counts.get(target) ?? 0;
    if (count === 1) {
      continue;
    }
    if (count > 1) {
      problems.push(`${location}: ambiguous target ${target}`);
      continue;
    }
    const foreign = entities.some((entity) => {
      const other = recordOf(entity);
      if (other.type !== 'Process' || other.id === recordOf(subject).id) {
        return false;
      }
      const otherActivities = recordOf(other.data).activities;
      if (!Array.isArray(otherActivities)) {
        return false;
      }
      return otherActivities.some((activity) => recordOf(activity).id === target);
    });
    problems.push(`${location}: ${foreign ? 'foreign' : 'undeclared'} target ${target}`);
  }
  if (problems.length === 0) {
    return { ok: true };
  }
  return { ok: false, context: { count: problems.length, starts: problems.join('; ') } };
}
