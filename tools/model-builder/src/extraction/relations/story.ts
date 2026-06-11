import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder, entityDomain, resolveRef } from './resolver.js';
import type { OperationDetail } from '../entities/story.js';

/**
 * Build Story → Operation relations from Story entities' operationsDetail.
 *
 * Resolution uses the shared displayId-based resolver (`resolveRef`) rather than a
 * reconstructed file-based internal id. This is required by the multi-file convention:
 * operations live in `*.domain.yaml` files (e.g. `order.domain.yaml`), so the internal
 * id (which bakes in the file basename) cannot be reconstructed from the ref alone. Matching by
 * displayId (e.g. `ordering.CMD020`) resolves the operation regardless of which file holds it.
 *
 * When the ref does not resolve, a Missing placeholder is created and the step is marked
 * resolved: false on the Story.
 */
export function buildStoryRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  const storyEntities = entities.filter((e) => e.type === ENTITY_TYPE.Story);

  for (const story of storyEntities) {
    const details = (story.data as { operationsDetail?: OperationDetail[] })?.operationsDetail ?? [];
    const sourceDomain = entityDomain(story);

    for (const op of details) {
      const ref = op.operationRef;
      // Absent ref → informational step (e.g. a narrative activity with no operation). Skip.
      if (!ref) continue;

      let targetId = resolveRef(ref, sourceDomain, entities);

      if (!targetId) {
        const placeholder = createPlaceholder(ref);
        if (!placeholders.has(placeholder.id)) {
          placeholders.set(placeholder.id, placeholder);
        }
        targetId = placeholder.id;

        const opsDetail = (story.data as { operationsDetail?: OperationDetail[] })?.operationsDetail;
        if (opsDetail && opsDetail[op.position] !== undefined) {
          opsDetail[op.position]!.resolved = false;
        }
        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
          // eslint-disable-next-line no-console
          console.warn(
            `Story operation '${op.name}' (ref: ${ref}) resolved to entity not found in model; created placeholder.`
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
