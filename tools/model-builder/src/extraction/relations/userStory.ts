import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from UserStory entities:
 * - actor → UserStoryActor (user_story → actor)
 * - operations[] → UserStoryOperation (user_story → operation)
 * - test_cases[] → UserStoryTestCase (user_story → test case)
 * - use_case → UserStoryUseCase (user_story → use case)
 */
export function extractUserStoryRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.UserStory) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // actor: single actor_ref
    const actor = data.actor as string | undefined;
    if (typeof actor === 'string' && actor) {
      const targetId = resolveOrPlaceholder(actor, domain, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.UserStoryActor}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.UserStoryActor,
      });
    }

    // operations[]: operation refs
    const operations = data.operations as string[] | undefined;
    if (Array.isArray(operations)) {
      for (const ref of operations) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.UserStoryOperation}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.UserStoryOperation,
        });
      }
    }

    // test_cases[]: test refs
    const testCases = data.test_cases as string[] | undefined;
    if (Array.isArray(testCases)) {
      for (const ref of testCases) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.UserStoryTestCase}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.UserStoryTestCase,
        });
      }
    }

    // use_case: single use_case_ref (back-pointer)
    const useCase = data.use_case as string | undefined;
    if (typeof useCase === 'string' && useCase) {
      const targetId = resolveOrPlaceholder(useCase, domain, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.UserStoryUseCase}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.UserStoryUseCase,
      });
    }
  }

  return relations;
}
