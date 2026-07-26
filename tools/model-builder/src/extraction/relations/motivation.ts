import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from motivation entities (v2.5 enrichments):
 * - risk.owner      → RiskOwner      (risk → actor)
 * - risk.goal_refs[] → RiskGoal      (risk → goal)
 * - assumption.risk_refs[] → AssumptionRisk (assumption → risk)
 */
export function extractMotivationRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    if (entity.type === ENTITY_TYPE.Risk) {
      // v2.5: owner — individual responsible for risk response
      const owner = data.owner as string | undefined;
      if (typeof owner === 'string' && owner) {
        const targetId = resolveOrPlaceholder(owner, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.RiskOwner}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.RiskOwner,
        });
      }

      // v2.5: goal_refs[] — goals this risk threatens
      const goalRefs = data.goal_refs as string[] | undefined;
      if (Array.isArray(goalRefs)) {
        for (const ref of goalRefs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.RiskGoal}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.RiskGoal,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.Assumption) {
      // v2.5: risk_refs[] — risks invalidated if assumption is wrong
      const riskRefs = data.risk_refs as string[] | undefined;
      if (Array.isArray(riskRefs)) {
        for (const ref of riskRefs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.AssumptionRisk}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.AssumptionRisk,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.Vision) {
      // v2.7.7 (D045): the vision's forward-links — identity → objectives → competencies → delivery.
      const visionRefFields: { field: string; type: string }[] = [
        { field: 'advances_goals', type: RELATION_TYPE.VisionAdvancesGoal },
        { field: 'capability_refs', type: RELATION_TYPE.VisionCapability },
        { field: 'value_stream_refs', type: RELATION_TYPE.VisionValueStream },
      ];
      for (const { field, type } of visionRefFields) {
        const refs = data[field] as string[] | undefined;
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${type}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type,
          });
        }
      }
    }
  }

  return relations;
}
