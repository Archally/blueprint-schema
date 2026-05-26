import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { resolveOrPlaceholder, entityDomain } from './resolver.js';

/**
 * Extract ValueStream relations:
 * - stages[].capabilities[] → Capability (ValueStreamCapability)
 * - goal_refs[] → Goal (ValueStreamGoal)
 * - metrics[] → KPI (ValueStreamKpi)
 * - primary_actors[] → Actor (ValueStreamActor)
 */
export function extractValueStreamRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.ValueStream) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // stages[].capabilities[] → Capability
    const stages = data.stages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(stages)) {
      for (const stage of stages) {
        if (!stage || typeof stage !== 'object') continue;
        const capabilities = stage.capabilities as string[] | undefined;
        if (!Array.isArray(capabilities)) continue;
        for (const ref of capabilities) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          const relationId = `${entity.id}--${RELATION_TYPE.ValueStreamCapability}--${targetId}`;
          relations.push({
            id: relationId,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.ValueStreamCapability,
            data: { stage: stage.name },
          });
        }
      }
    }

    // goal_refs[] → Goal
    const goalRefs = data.goal_refs as string[] | undefined;
    if (Array.isArray(goalRefs)) {
      for (const ref of goalRefs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.ValueStreamGoal}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.ValueStreamGoal,
        });
      }
    }

    // metrics[] → KPI (flat array of kpi_ref strings)
    const metrics = data.metrics as string[] | undefined;
    if (Array.isArray(metrics)) {
      for (const ref of metrics) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.ValueStreamKpi}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.ValueStreamKpi,
        });
      }
    }

    // primary_actors[] → Actor
    const primaryActors = data.primary_actors as string[] | undefined;
    if (Array.isArray(primaryActors)) {
      for (const ref of primaryActors) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.ValueStreamActor}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.ValueStreamActor,
        });
      }
    }
  }

  return relations;
}
