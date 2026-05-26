import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

const RULE_ENTITY_TYPES = new Set([
  ENTITY_TYPE.StructuralRule,
  ENTITY_TYPE.ClassificationRule,
  ENTITY_TYPE.DerivationRule,
  ENTITY_TYPE.EquivalenceRule,
  ENTITY_TYPE.ValidationRule,
]);

/**
 * Extract relations from rule-layer entities:
 * - Rule.concepts[] → concepts (rule → concept)
 * - TransitionRule.concept → concept (transition rule → concept it governs)
 */
export function extractRuleRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    if (RULE_ENTITY_TYPES.has(entity.type as (typeof ENTITY_TYPE.StructuralRule))) {
      // Rule.concepts[]: concepts this rule constrains or references
      const concepts = data.concepts as string[] | undefined;
      if (Array.isArray(concepts)) {
        for (const ref of concepts) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.Concepts}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.Concepts,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.TransitionRule) {
      // TransitionRule.concept: the concept whose lifecycle this transition belongs to
      const conceptRef = data.concept as string | undefined;
      if (conceptRef) {
        const targetId = resolveOrPlaceholder(conceptRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Concept}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Concept,
        });
      }
    }
  }

  return relations;
}
