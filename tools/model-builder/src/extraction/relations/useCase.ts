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
    // step is a human act no operation describes. Both reach the same edge types the use case
    // already produces, because naming an actor at step 5 makes the same KIND of statement as
    // naming one as `primary_actor`; what differs is WHERE in the use case it was said.
    //
    // Which is why a step-derived edge carries its step, in the id and in `data`. Without it, two
    // steps naming one target produce byte-identical ids and the global dedupe in `relations/
    // index.ts` keeps one, silently. That is not hypothetical: across the corpus it loses 9 of 284
    // step operation edges and 4 of 6 extension actor edges. `primary_actor`'s id is deliberately
    // left unsuffixed, so it never collides with a step edge and existing ids do not move.
    //
    // The step goes in `data` as well as the id because an id is not an API: a consumer asking
    // which step an actor performs must not have to parse a string to find out. That question is
    // the point of the edge - a process diagram needs per-step performers, while "which actors does
    // this use case involve" is answered by deduplicating on the target.
    //
    // The disambiguator is the ARRAY INDEX, not `step`. Extensions branch AT a step, so two
    // alternatives may both declare `step: 2`, and a number that can repeat cannot make an id
    // unique. `step` is reported in `data`, where repeating is fine because it is the fact rather
    // than the key.
    const scenario = data.main_scenario as Array<Record<string, unknown>> | undefined;
    const extensions = data.extensions as Array<Record<string, unknown>> | undefined;
    const steps: { step: Record<string, unknown>; scenario: 'main' | 'extension'; index: number }[] = [
      ...(Array.isArray(scenario) ? scenario : []).map((step, index) => ({ step, scenario: 'main' as const, index })),
      ...(Array.isArray(extensions) ? extensions : []).map((step, index) => ({ step, scenario: 'extension' as const, index })),
    ];

    for (const { step, scenario: kind, index } of steps) {
      if (!step || typeof step !== 'object') continue;
      const at = `${kind}-${index}`;
      const stepData = { scenario: kind, step: step.step ?? null };

      const pushStepRelation = (type: string, ref: string): void => {
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${type}--${targetId}--${at}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type,
          data: stepData,
        });
      };

      // "Consulted only when `operation` is absent" is the schema's rule for both spellings, and
      // it is enforced here rather than assumed: a step carrying both would otherwise put two
      // answers in the graph for one performer, and the one derived from `initiated_by` is the
      // one the rule keeps.
      const actor = step.operation ? undefined : (step.actor as string | undefined);
      if (typeof actor === 'string' && actor) pushStepRelation(RELATION_TYPE.UseCaseActor, actor);

      const screen = step.screen as string | undefined;
      if (typeof screen === 'string' && screen) pushStepRelation(RELATION_TYPE.UseCaseScreen, screen);

      const operation = step.operation as string | undefined;
      if (typeof operation === 'string' && operation) pushStepRelation(RELATION_TYPE.UseCaseOperation, operation);
    }
  }

  return relations;
}
