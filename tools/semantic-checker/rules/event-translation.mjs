/**
 * Whether an operation's `translates` pairs a published integration event with unpublished domain
 * events of its own context.
 *
 * Not expressible in the rule DSL: the verdict compares the subject with each target of its
 * `translates` edges - their kinds, the slices they are declared in and their derived reach - and
 * the DSL tests one entity's fields or one relation's presence, not two entities against each other.
 *
 * Context is the slice an event is declared in: the first directory of its file, or `default` for a
 * file at the model root. It is the boundary event reach itself reads, so this rule and the reach
 * verdict cannot disagree about where an event lives.
 *
 * Silent for an operation with no `translates` edge, and for an entry that resolves to nothing,
 * which builds an edge to a placeholder and is already a cross-reference error with a file and a
 * location.
 */

const TRANSLATES = 'translates';
const OPERATION = 'Operation';
const PUBLISHED = 'published';

/** Subject handle -> its translates targets in the order the model states them, once per model. */
const cache = new WeakMap();

function translationsBySource(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const byHandle = new Map();
  for (const entity of model.entities ?? []) byHandle.set(entity.id, entity);
  const index = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== TRANSLATES) continue;
    const target = byHandle.get(relation.target);
    if (!target) continue;
    const list = index.get(relation.source) ?? [];
    list.push(target);
    index.set(relation.source, list);
  }
  cache.set(model, index);
  return index;
}

/** The slice an entity is declared in, read as event reach reads it. */
function sliceOf(entity) {
  const segments = String(entity?.fileOrigin ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 1 ? segments[0] : 'default';
}

const labelOf = (entity) => entity?.data?.id ?? entity?.displayId ?? entity?.id ?? '?';
const kindOf = (entity) => (typeof entity?.data?.kind === 'string' ? entity.data.kind : undefined);
const reachOf = (entity) => (typeof entity?.data?._event_reach === 'string' ? entity.data._event_reach : undefined);

/** What one entry says that a domain event of the subject's own context would not. */
function targetProblem(subject, target) {
  const label = `"${labelOf(target)}"`;
  const kind = kindOf(target);
  if (kind !== 'event') return `it names ${label}, which is a ${kind ?? 'operation'} rather than an event`;
  if (sliceOf(target) !== sliceOf(subject)) return `it names ${label}, an event of another context (\`${sliceOf(target)}\`)`;
  if (reachOf(target) === PUBLISHED) return `it names ${label}, which is itself published`;
  return null;
}

/** An operation stating `translates` that is not a published event, or whose entries are not domain events of its context. */
export const translationTargetNotInternal = (model, subject) => {
  const targets = translationsBySource(model).get(subject?.id);
  if (!targets || targets.length === 0) return { ok: true };
  // A placeholder stands in for an entry nothing declares: the validator reports it, so it is skipped.
  const resolved = targets.filter((target) => target.type === OPERATION);
  if (resolved.length === 0) return { ok: true };

  const problems = [];
  const kind = kindOf(subject);
  if (kind !== 'event') problems.push(`it is a ${kind ?? 'operation'} rather than an event`);
  else if (reachOf(subject) !== PUBLISHED) {
    problems.push('it is not published: no contract sends or receives it and its exchange names no messaging channel');
  }
  for (const target of resolved) {
    const problem = targetProblem(subject, target);
    if (problem && !problems.includes(problem)) problems.push(problem);
  }
  if (problems.length === 0) return { ok: true };
  return {
    ok: false,
    context: {
      subject: labelOf(subject),
      subject_name: subject?.name ?? subject?.data?.name ?? '',
      problems: problems.join('; '),
    },
  };
};
