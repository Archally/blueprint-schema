import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder } from './resolver.js';
import type { OperationDetail } from '../entities/story.js';

/**
 * Build Story → Operation relations from Story entities' operationsDetail.
 * When resolvedEntityId does not exist in the entity set, creates a Missing
 * placeholder and relation, and marks that step as resolved: false on the Story.
 */
export function buildStoryRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];
  const entityIds = new Set(entities.map((e) => e.id));

  const storyEntities = entities.filter((e) => e.type === ENTITY_TYPE.Story);

  for (const story of storyEntities) {
    const details = (story.data as { operationsDetail?: OperationDetail[] })?.operationsDetail ?? [];

    for (const op of details) {
      if (!op.resolved || !op.resolvedEntityId) continue;

      let targetId = op.resolvedEntityId;

      // Try fallback entity ID (old format without scope prefix) if primary doesn't match
      if (!entityIds.has(targetId) && op.fallbackEntityId && entityIds.has(op.fallbackEntityId)) {
        targetId = op.fallbackEntityId;
      }

      if (!entityIds.has(targetId)) {
        const ref = op.operationRef ?? op.resolvedEntityId;
        const placeholder = createPlaceholder(ref);
        if (!placeholders.has(placeholder.id)) {
          placeholders.set(placeholder.id, placeholder);
        }
        targetId = placeholder.id;
        entityIds.add(placeholder.id);

        const storyData = story.data as { operationsDetail?: OperationDetail[] };
        const opsDetail = storyData?.operationsDetail;
        if (opsDetail && opsDetail[op.position] !== undefined) {
          opsDetail[op.position]!.resolved = false;
        }
        // Log warning per step: optional in Node (no console in tests is fine)
        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
          // eslint-disable-next-line no-console
          console.warn(
            `Story operation '${op.name}' (ref: ${op.operationRef ?? op.resolvedEntityId}) resolved to entity not found in model; created placeholder.`
          );
        }
      }

      relations.push({
        id: `${story.id}_orders_${targetId}_${op.position}`,
        source_entity_id: story.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.StoryOrdersOperation,
        predicate: `orders at position ${op.position}`,
        data: { position: op.position, component: op.component },
      });
    }
  }

  return relations;
}
