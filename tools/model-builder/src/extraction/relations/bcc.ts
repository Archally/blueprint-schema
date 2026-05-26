import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Bounded Context Canvas v5 (v2.6.3) relations:
 * - BusinessDecision → Context (bounded_context_ref) [required]
 * - BusinessDecision → Context (linked_contexts[]) [optional, cross-context policy]
 * - BusinessDecision → UserStory (linked_user_stories[]) [optional]
 * - Assumption → Context (bounded_context_ref) [optional, BCC linkage]
 * - KPI → Context (bounded_context_ref) [optional, BCC verification metric linkage]
 *
 * The bounded_context_ref value is a kebab-case context name (context_prefix
 * pattern), which the resolver matches against Context.displayId.
 */
export function extractBccRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;
    const domain = entityDomain(entity);

    // bounded_context_ref applies to BusinessDecision (required), Assumption
    // (optional), and KPI (optional). Use the same relation type for all.
    if (
      entity.type === ENTITY_TYPE.BusinessDecision ||
      entity.type === ENTITY_TYPE.Assumption ||
      entity.type === ENTITY_TYPE.KPI
    ) {
      const ref = data.bounded_context_ref;
      if (typeof ref === 'string' && ref) {
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.BoundedContextRef}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.BoundedContextRef,
        });
      }
    }

    // BusinessDecision-specific cross-context + user-story linkage.
    if (entity.type === ENTITY_TYPE.BusinessDecision) {
      const linkedContexts = data.linked_contexts as string[] | undefined;
      if (Array.isArray(linkedContexts)) {
        for (const ref of linkedContexts) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.BusinessDecisionLinkedContext}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.BusinessDecisionLinkedContext,
          });
        }
      }

      const linkedUserStories = data.linked_user_stories as string[] | undefined;
      if (Array.isArray(linkedUserStories)) {
        for (const ref of linkedUserStories) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.BusinessDecisionLinkedUserStory}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.BusinessDecisionLinkedUserStory,
          });
        }
      }
    }
  }

  return relations;
}
