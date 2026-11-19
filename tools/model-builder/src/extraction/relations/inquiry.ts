import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from Inquiry entities (v2.5):
 * - inquiry.goal_refs[]     → InquiryGoal       (inquiry → goal)
 * - inquiry.risk_refs[]     → InquiryRisk       (inquiry → risk)
 * - inquiry.question_refs[] → InquiryQuestion   (inquiry → question)
 * - inquiry.finding_refs[]  → InquiryFinding    (inquiry → finding)
 * - inquiry.owner           → InquiryOwner      (inquiry → actor or team)
 * - inquiry.stakeholders[]  → InquiryStakeholder (inquiry → actor)
 * - inquiry.asked_of        → InquiryAskedOf    (inquiry → actor or team; a name alone draws no edge)
 * - inquiry.previously_asked_of[].asked_of → InquiryPreviouslyAskedOf (inquiry → actor or team), one
 *   edge per entry with its position, outcome and date, so an addressee asked twice has two edges
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

    // finding_refs[] → InquiryFinding
    const findingRefs = data.finding_refs as string[] | undefined;
    if (Array.isArray(findingRefs)) {
      for (const ref of findingRefs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.InquiryFinding}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.InquiryFinding,
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

    // asked_of → InquiryAskedOf: the reference arm is the addressee; a name beside it rides as data.
    const askedOf = addresseeRef(data.asked_of);
    if (askedOf) {
      const targetId = resolveOrPlaceholder(askedOf.ref, domain, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.InquiryAskedOf}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.InquiryAskedOf,
        ...(askedOf.name ? { data: { name: askedOf.name } } : {}),
      });
    }

    // previously_asked_of[].asked_of → InquiryPreviouslyAskedOf, oldest first, kept apart from the
    // current addressee so "asked of me now" never mixes with "asked of me before".
    const earlier = data.previously_asked_of;
    if (Array.isArray(earlier)) {
      for (const [position, item] of earlier.entries()) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const addressee = addresseeRef(entry.asked_of);
        if (!addressee) continue;
        const targetId = resolveOrPlaceholder(addressee.ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.InquiryPreviouslyAskedOf}--${position}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.InquiryPreviouslyAskedOf,
          data: {
            position,
            ...(typeof entry.outcome === 'string' ? { outcome: entry.outcome } : {}),
            ...(typeof entry.date === 'string' ? { date: entry.date } : {}),
            ...(addressee.name ? { name: addressee.name } : {}),
          },
        });
      }
    }
  }

  return relations;
}

/**
 * The reference an addressee (`{ actor | team | name }`) names, with the name stated beside it.
 * A name alone names no entity, so it yields nothing here.
 */
function addresseeRef(value: unknown): { ref: string; name?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const addressee = value as Record<string, unknown>;
  const ref = [addressee.actor, addressee.team].find((arm): arm is string => typeof arm === 'string' && arm !== '');
  if (!ref) return undefined;
  const name = typeof addressee.name === 'string' && addressee.name.trim() !== '' ? addressee.name : undefined;
  return name ? { ref, name } : { ref };
}
