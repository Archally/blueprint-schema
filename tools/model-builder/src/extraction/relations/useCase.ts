import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from UseCase entities:
 * - primary_actor → UseCaseActor (use_case → actor)
 * - user_stories[] → UseCaseUserStory (use_case → user story)
 * - stories[] → UseCaseStory (use_case → story STR###)
 * - main_scenario[].screen → UseCaseScreen (use_case → screen)
 * - main_scenario[].operation → UseCaseOperation (use_case → operation)
 * - main_scenario[].actor, extensions[].actor → UseCaseActor (use_case → actor)
 */
export function extractUseCaseRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.UseCase) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // primary_actor: single actor_ref
    const primaryActor = data.primary_actor as string | undefined;
    if (typeof primaryActor === 'string' && primaryActor) {
      const targetId = resolveOrPlaceholder(primaryActor, domain, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.UseCaseActor}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.UseCaseActor,
      });
    }

    // user_stories[]: user_story refs
    const userStories = data.user_stories as string[] | undefined;
    if (Array.isArray(userStories)) {
      for (const ref of userStories) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.UseCaseUserStory}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.UseCaseUserStory,
        });
      }
    }

    // stories[]: story refs (STR###)
    const stories = data.stories as string[] | undefined;
    if (Array.isArray(stories)) {
      for (const ref of stories) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.UseCaseStory}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.UseCaseStory,
        });
      }
    }

    // main_scenario[] and extensions[]: screen, operation and actor refs from each step.
    //
    // A step names its performer one of two ways, and only one of them at a time: through the
    // `operation` it carries, whose `initiated_by` says who runs it, or through `actor` when the
    // step is a human act no operation describes. Both spellings reach the same `UseCaseActor`
    // edge that `primary_actor` already produces, because "this use case involves this actor" is
    // the same statement wherever in the use case it is made.
    //
    // Extensions are read here for the first time. Their `actor` has been schema-valid and
    // reference-resolved since it was added, and reached no edge, so a branch performed by someone
    // was invisible to every graph consumer while looking correct in the document.
    const scenario = data.main_scenario as Array<Record<string, unknown>> | undefined;
    const extensions = data.extensions as Array<Record<string, unknown>> | undefined;
    const steps = [
      ...(Array.isArray(scenario) ? scenario : []),
      ...(Array.isArray(extensions) ? extensions : []),
    ];
    if (steps.length > 0) {
      for (const step of steps) {
        if (!step || typeof step !== 'object') continue;

        // "Consulted only when `operation` is absent" is the schema's rule for both spellings, and
        // it is enforced here rather than assumed: a step carrying both would otherwise put two
        // answers in the graph for one performer, and the one derived from `initiated_by` is the
        // one the rule keeps.
        const actor = step.operation ? undefined : (step.actor as string | undefined);
        if (typeof actor === 'string' && actor) {
          const targetId = resolveOrPlaceholder(actor, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.UseCaseActor}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.UseCaseActor,
          });
        }

        const screen = step.screen as string | undefined;
        if (typeof screen === 'string' && screen) {
          const targetId = resolveOrPlaceholder(screen, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.UseCaseScreen}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.UseCaseScreen,
          });
        }

        const operation = step.operation as string | undefined;
        if (typeof operation === 'string' && operation) {
          const targetId = resolveOrPlaceholder(operation, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.UseCaseOperation}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.UseCaseOperation,
          });
        }
      }
    }
  }

  return relations;
}
