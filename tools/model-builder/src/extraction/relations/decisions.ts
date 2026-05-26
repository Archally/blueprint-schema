import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

const MOTIVATION_GROUPS: ReadonlyArray<{ key: string; predicate: string }> = [
  { key: 'goals', predicate: 'goal' },
  { key: 'risks', predicate: 'risk' },
  { key: 'assumptions', predicate: 'assumption' },
  { key: 'trade_offs', predicate: 'trade_off' },
  { key: 'questions', predicate: 'question' },
  { key: 'inquiries', predicate: 'inquiry' },
];

const IMPACT_GROUPS: ReadonlyArray<{ key: string; predicate: string }> = [
  { key: 'concepts', predicate: 'concept' },
  { key: 'rules', predicate: 'rule' },
  { key: 'operations', predicate: 'operation' },
  { key: 'tests', predicate: 'test' },
  { key: 'models', predicate: 'model' },
  { key: 'stories', predicate: 'story' },
];

const IMPACT_UI_GROUPS: ReadonlyArray<{ key: string; predicate: string }> = [
  { key: 'screens', predicate: 'screen' },
  { key: 'actions', predicate: 'ui_action' },
  { key: 'navigation', predicate: 'ui_navigation' },
];

/**
 * Extract relations from decision entities:
 * - Decision.motivation_refs.{goals,risks,assumptions,trade_offs,questions,inquiries}[] → motivation_refs
 * - Decision.capability_refs[] → capability_refs
 * - Decision.declared_impact.direct.{concepts,rules,operations,tests}[] → declared_impact
 */
export function extractDecisionRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Decision) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // motivation_refs: { goals[], risks[], assumptions[], trade_offs[] }
    const motivationRefs = data.motivation_refs as Record<string, unknown> | undefined;
    if (motivationRefs && typeof motivationRefs === 'object') {
      for (const { key, predicate } of MOTIVATION_GROUPS) {
        const refs = (motivationRefs as Record<string, unknown>)[key];
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.MotivationRefs}--${predicate}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.MotivationRefs,
            predicate,
          });
        }
      }
    }

    // capability_refs[]: plain capability ref strings
    const capabilityRefs = data.capability_refs as string[] | undefined;
    if (Array.isArray(capabilityRefs)) {
      for (const ref of capabilityRefs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.CapabilityRefs}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.CapabilityRefs,
        });
      }
    }

    // declared_impact.direct.{concepts,rules,operations,tests,models,stories}[]
    const declaredImpact = data.declared_impact as Record<string, unknown> | undefined;
    const direct = declaredImpact?.direct as Record<string, unknown> | undefined;
    if (direct && typeof direct === 'object') {
      for (const { key, predicate } of IMPACT_GROUPS) {
        const refs = (direct as Record<string, unknown>)[key];
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.DeclaredImpact}--${predicate}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.DeclaredImpact,
            predicate,
          });
        }
      }

      // declared_impact.direct.ui.{screens,actions,navigation}[]
      const ui = direct.ui as Record<string, unknown> | undefined;
      if (ui && typeof ui === 'object') {
        for (const { key, predicate } of IMPACT_UI_GROUPS) {
          const refs = (ui as Record<string, unknown>)[key];
          if (!Array.isArray(refs)) continue;
          for (const ref of refs) {
            if (typeof ref !== 'string' || !ref) continue;
            const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
            relations.push({
              id: `${entity.id}--${RELATION_TYPE.DeclaredImpact}--${predicate}--${targetId}`,
              source_entity_id: entity.id,
              target_entity_id: targetId,
              type: RELATION_TYPE.DeclaredImpact,
              predicate,
            });
          }
        }
      }
    }
  }

  return relations;
}
