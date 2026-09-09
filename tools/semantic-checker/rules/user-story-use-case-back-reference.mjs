/**
 * The link between a use case and the user stories that realise it, written from both ends.
 *
 * `use_case.user_stories[]` is where the link is stated. `user_story.use_case` says the same thing
 * from the other end and is soft-deprecated: one relationship written twice is two statements that
 * can disagree, and a neighbour query then answers differently depending on which end it starts
 * from.
 *
 * The two ends are read as RELATIONS rather than as raw fields, so a namespaced reference
 * (`customers.UC001`) and a bare one (`UC001`) are compared after the model builder has resolved
 * both to the same entity - comparing the strings would report a disagreement between two
 * spellings of one id.
 *
 * A back-pointer the use case already carries can simply be deleted; one it does not carry is the
 * only statement of that link, so the use case has to gain it first. The finding says which, per
 * use case, because the two need opposite edits.
 */

const BACK_POINTER = 'user_story_use_case';
const CANONICAL = 'use_case_user_story';

/**
 * A user story that names its use case through the deprecated back-pointer, with the remedy each
 * named use case needs.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function userStoryUseCaseBackReference(model, subject) {
  const storyId = subject && typeof subject === 'object' ? /** @type {any} */ (subject).id : undefined;
  if (typeof storyId !== 'string') return { ok: true };

  const carried = new Set();
  for (const relation of model.relations) {
    if (relation.type === CANONICAL && relation.target === storyId) carried.add(relation.source);
  }

  const byId = new Map(model.entities.map((entity) => [entity.id, entity]));
  const cases = [];
  for (const relation of model.relations) {
    if (relation.type !== BACK_POINTER || relation.source !== storyId) continue;
    const useCase = byId.get(relation.target);
    const label = useCase?.displayId ?? relation.target;
    cases.push(
      carried.has(relation.target)
        ? `${label} - already lists this story, so the back-pointer can go`
        : `${label} - does NOT list this story, so add it to \`user_stories[]\` first`
    );
  }
  if (cases.length === 0) return { ok: true };
  return { ok: false, context: { count: String(cases.length), cases } };
}
