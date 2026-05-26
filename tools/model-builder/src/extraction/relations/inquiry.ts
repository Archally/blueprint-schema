import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from Inquiry entities (v2.5):
 * - inquiry.goal_refs[]     → InquiryGoal       (inquiry → goal)
 * - inquiry.risk_refs[]     → InquiryRisk       (inquiry → risk)
 * - inquiry.question_refs[] → InquiryQuestion   (inquiry → question)
 * - inquiry.owner           → InquiryOwner      (inquiry → actor)
 * - inquiry.stakeholders[]  → InquiryStakeholder (inquiry → actor)
 */
export function extractInquiryRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Inquiry) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // goal_refs[] → InquiryGoal
    const goalRefs = data.goal_refs as string[] | undefined;
    if (Array.isArray(goalRefs)) {
      for (const ref of goalRefs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.InquiryGoal}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.InquiryGoal,
        });
      }
    }

    // risk_refs[] → InquiryRisk
    const riskRefs = data.risk_refs as string[] | undefined;
    if (Array.isArray(riskRefs)) {
      for (const ref of riskRefs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.InquiryRisk}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.InquiryRisk,
        });
      }
    }

    // question_refs[] → InquiryQuestion
    const questionRefs = data.question_refs as string[] | undefined;
    if (Array.isArray(questionRefs)) {
      for (const ref of questionRefs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.InquiryQuestion}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.InquiryQuestion,
        });
      }
    }

    // owner → InquiryOwner
    const owner = data.owner as string | undefined;
    if (typeof owner === 'string' && owner) {
      const targetId = resolveOrPlaceholder(owner, domain, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.InquiryOwner}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.InquiryOwner,
      });
    }

    // stakeholders[] → InquiryStakeholder
    const stakeholders = data.stakeholders as string[] | undefined;
    if (Array.isArray(stakeholders)) {
      for (const ref of stakeholders) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.InquiryStakeholder}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.InquiryStakeholder,
        });
      }
    }
  }

  return relations;
}
