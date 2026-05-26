import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from Milestone entities:
 * - dependencies[] → MilestoneDependency (milestone → milestone)
 * - deliverables[].ref → MilestoneDeliverable (milestone → entity)
 */
export function extractRoadmapRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Milestone) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // dependencies[]: milestone refs (MS###)
    const dependencies = data.dependencies as string[] | undefined;
    if (Array.isArray(dependencies)) {
      for (const ref of dependencies) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.MilestoneDependency}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.MilestoneDependency,
        });
      }
    }

    // deliverables[]: polymorphic refs (kind + ref)
    const deliverables = data.deliverables as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(deliverables)) {
      for (const deliverable of deliverables) {
        if (!deliverable || typeof deliverable !== 'object') continue;
        const ref = deliverable.ref as string | undefined;
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        const kind = deliverable.kind as string | undefined;
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.MilestoneDeliverable}--${kind ?? 'unknown'}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.MilestoneDeliverable,
          predicate: kind,
        });
      }
    }
  }

  return relations;
}
