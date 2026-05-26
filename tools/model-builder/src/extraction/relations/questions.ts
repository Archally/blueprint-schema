import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from Question entities:
 * - Question.answered_by[] → question_answered_by (question → operation of any kind)
 * - Question.concepts[] → question_about (question → concept)
 * - Question.motivated_by[] → question_motivated_by (question → goal)
 * - Question.stakeholders[] → question_stakeholder (question → actor)
 */
export function extractQuestionRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Question) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // answered_by[]: operation refs (any kind: CMD, EVT, QRY, DOC)
    const answeredBy = data.answered_by as string[] | undefined;
    if (Array.isArray(answeredBy)) {
      for (const ref of answeredBy) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.QuestionAnsweredBy}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.QuestionAnsweredBy,
        });
      }
    }

    // concepts[]: concept refs
    const concepts = data.concepts as string[] | undefined;
    if (Array.isArray(concepts)) {
      for (const ref of concepts) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.QuestionAbout}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.QuestionAbout,
        });
      }
    }

    // motivated_by[]: goal refs
    const motivatedBy = data.motivated_by as string[] | undefined;
    if (Array.isArray(motivatedBy)) {
      for (const ref of motivatedBy) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.QuestionMotivatedBy}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.QuestionMotivatedBy,
        });
      }
    }

    // stakeholders[]: actor refs
    const stakeholders = data.stakeholders as string[] | undefined;
    if (Array.isArray(stakeholders)) {
      for (const ref of stakeholders) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.QuestionStakeholder}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.QuestionStakeholder,
        });
      }
    }

    // v2.5: owner — actor responsible for driving resolution
    const owner = data.owner as string | undefined;
    if (typeof owner === 'string' && owner) {
      const targetId = resolveOrPlaceholder(owner, domain, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.QuestionOwner}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.QuestionOwner,
      });
    }
  }

  return relations;
}
