import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

const VALIDATES_GROUPS: ReadonlyArray<{ key: string; predicate: string }> = [
  { key: 'rules', predicate: 'rule' },
  { key: 'operations', predicate: 'operation' },
  { key: 'concepts', predicate: 'concept' },
  { key: 'models', predicate: 'model' },
  { key: 'stories', predicate: 'story' },
  { key: 'ownership', predicate: 'ownership' },
  { key: 'questions', predicate: 'question' },
];

const VALIDATES_UI_GROUPS: ReadonlyArray<{ key: string; predicate: string }> = [
  { key: 'screens', predicate: 'screen' },
  { key: 'actions', predicate: 'ui_action' },
];

/**
 * Extract relations from test case entities:
 * - TestCase.validates.{rules,operations,concepts,models,stories,ownership}[] → validates
 * - TestCase.validates.ui.{screens,actions}[] → validates (nested UI)
 */
export function extractTestCaseRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.TestCase) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    const validates = data.validates as Record<string, unknown> | undefined;
    if (!validates || typeof validates !== 'object') continue;

    for (const { key, predicate } of VALIDATES_GROUPS) {
      const refs = (validates as Record<string, unknown>)[key];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Validates}--${predicate}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Validates,
          predicate,
        });
      }
    }

    // validates.ui.{screens,actions}[]
    const ui = validates.ui as Record<string, unknown> | undefined;
    if (ui && typeof ui === 'object') {
      for (const { key, predicate } of VALIDATES_UI_GROUPS) {
        const refs = (ui as Record<string, unknown>)[key];
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.Validates}--${predicate}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.Validates,
            predicate,
          });
        }
      }
    }
  }

  return relations;
}
