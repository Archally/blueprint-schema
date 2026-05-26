import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract relations from concept-layer entities:
 * - Concept.relationships[] → relationship (concept → concept)
 * - Concept.transition_rules[] → transition_rules (concept → TransitionRule)
 * - Actor.interactions[] → interaction (actor → concept/operation)
 * - Association.subject → Association.object → association (concept → concept)
 */
export function extractConceptRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    if (entity.type === ENTITY_TYPE.Concept) {
      // Concept.relationships[]: owned relationships to other concepts
      const relationships = data.relationships as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(relationships)) {
        for (const rel of relationships) {
          const objectRef = rel.object as string | undefined;
          if (!objectRef) continue;
          const targetId = resolveOrPlaceholder(objectRef, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.Relationship}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.Relationship,
            predicate: rel.predicate as string | undefined,
            data: rel.cardinality != null ? { cardinality: rel.cardinality } : undefined,
          });
        }
      }

      // Concept.transition_rules[]: refs to transition rules governing this concept's lifecycle
      const transitionRules = data.transition_rules as string[] | undefined;
      if (Array.isArray(transitionRules)) {
        for (const ref of transitionRules) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.TransitionRules}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.TransitionRules,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.Actor) {
      // Actor.interactions[]: what concepts/operations this actor interacts with
      const interactions = data.interactions as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(interactions)) {
        for (const interaction of interactions) {
          const targetRef = interaction.target as string | undefined;
          if (!targetRef) continue;
          const targetId = resolveOrPlaceholder(targetRef, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.Interaction}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.Interaction,
            predicate: interaction.verb as string | undefined,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.Association) {
      // Association: named cross-concept relationship with explicit subject and object
      const subjectRef = data.subject as string | undefined;
      const objectRef = data.object as string | undefined;
      if (subjectRef && objectRef) {
        const sourceConceptId = resolveOrPlaceholder(subjectRef, domain, entities, placeholders);
        const targetConceptId = resolveOrPlaceholder(objectRef, domain, entities, placeholders);
        relations.push({
          id: `${sourceConceptId}--${RELATION_TYPE.Association}--${targetConceptId}`,
          source_entity_id: sourceConceptId,
          target_entity_id: targetConceptId,
          type: RELATION_TYPE.Association,
          predicate: data.predicate as string | undefined,
        });
      }
    }
  }

  return relations;
}
