import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * The stakeholder and what that stakeholder expects, as edges.
 *
 * Four, and they form one chain: an actor is refined by a persona, the persona holds a concern, the
 * concern is about a part of the model, and a user story may address the concern. Read end to end
 * it answers "does what we built reach the person who needs it", which is the question none of the
 * four edges answers alone.
 *
 *   - `PersonaActor` (Persona -> Actor). A persona declared at the document root names its actor
 *     through `actor_ref`. One written inside its actor states the same fact by position, and the
 *     entity extractor stamps that position as `_actor` - the declared form wins where both are
 *     present, since a value someone typed is the more deliberate of the two.
 *
 *   - `ConcernPersona` (Concern -> Persona), from `concern.persona_ref`.
 *
 *   - `ConcernAbout` (Concern -> user story | use case | process | screen | concept), from
 *     `concern.about_ref`. One edge type across all five targets: a consumer asking what a persona
 *     expects of some part of the model asks the same question whichever kind that part is, and
 *     five types would make it five queries.
 *
 *   - `UserStoryConcern` (UserStory -> Concern), from `user_story.concern_ref`.
 *
 * Every reference resolves through the shared placeholder registry, so one naming an entity the
 * model does not declare still produces an edge, to a Missing node, rather than dropping the fact.
 */
export function extractPersonaConcernRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  const edge = (source: Entity, type: string, ref: string): void => {
    const targetId = resolveOrPlaceholder(ref, entityDomain(source), entities, placeholders);
    relations.push({
      id: `${source.id}--${type}--${targetId}`,
      source_entity_id: source.id,
      target_entity_id: targetId,
      type,
    });
  };

  const refOf = (entity: Entity, key: string): string | undefined => {
    const value = (entity.data as Record<string, unknown> | undefined)?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.Persona) {
      const actorRef = refOf(entity, 'actor_ref') ?? refOf(entity, '_actor');
      if (actorRef) edge(entity, RELATION_TYPE.PersonaActor, actorRef);
      continue;
    }

    if (entity.type === ENTITY_TYPE.Concern) {
      const personaRef = refOf(entity, 'persona_ref');
      if (personaRef) edge(entity, RELATION_TYPE.ConcernPersona, personaRef);
      const aboutRef = refOf(entity, 'about_ref');
      if (aboutRef) edge(entity, RELATION_TYPE.ConcernAbout, aboutRef);
      continue;
    }

    if (entity.type === ENTITY_TYPE.UserStory) {
      const concernRef = refOf(entity, 'concern_ref');
      if (concernRef) edge(entity, RELATION_TYPE.UserStoryConcern, concernRef);
    }
  }

  return relations;
}
