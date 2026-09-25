import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';
import { resolveModelRefOrPlaceholder } from './modelRef.js';

/**
 * The axes of `validates`. `models` carries `modelRef`, because `validates.models[]` is a
 * `model_ref` and the other axes are typed ids - see `modelRef.ts` for the four forms and why
 * resolving one by typed id alone turns a component the model declares into a gray placeholder.
 */
export const VALIDATES_GROUPS: ReadonlyArray<{ key: string; predicate: string; modelRef?: true }> = [
  { key: 'rules', predicate: 'rule' },
  // transition rules (TR) are Rule entities too, but rule_ref excludes TR; a dedicated
  // group lets tests link to transitions so they are not flagged untested.
  { key: 'transitions', predicate: 'transition' },
  { key: 'operations', predicate: 'operation' },
  { key: 'concepts', predicate: 'concept' },
  { key: 'models', predicate: 'model', modelRef: true },
  // Both spellings of the same axis are read. `stories` is what a v2.7 model states and
  // `processes` is what a v2.8 model states; a model on disk answers in one of the two and a
  // reader of the graph should not have to know which. Neither key implies the other's absence,
  // so a model stating both contributes both.
  { key: 'stories', predicate: 'story' },
  { key: 'processes', predicate: 'process' },
  { key: 'use_cases', predicate: 'use_case' },
  { key: 'ownership', predicate: 'ownership' },
  { key: 'questions', predicate: 'question' },
  // Infrastructure resources (IR###) a test asserts the placement or behaviour of.
  { key: 'infrastructure', predicate: 'infra_resource' },
];

export const VALIDATES_UI_GROUPS: ReadonlyArray<{ key: string; predicate: string }> = [
  { key: 'screens', predicate: 'screen' },
  { key: 'actions', predicate: 'ui_action' },
  { key: 'navigation', predicate: 'ui_navigation' },
];

/**
 * Extract relations from test case entities:
 * - TestCase.validates.<axis>[] → validates, one relation per ref, for every axis in
 *   VALIDATES_GROUPS
 * - TestCase.validates.ui.{screens,actions,navigation}[] → validates (nested UI)
 *
 * The two group tables are the complete set of axes this extractor reads. Every property the
 * schema's `validates_refs` declares must appear in one of them, or the edges a model states on
 * that axis reach no consumer - the graph, `bp check`'s untested-entity verdict and every
 * coverage number downstream all count relations, so an unread axis reads as an unlinked model.
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

    for (const { key, predicate, modelRef } of VALIDATES_GROUPS) {
      const refs = (validates as Record<string, unknown>)[key];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = modelRef
          ? resolveModelRefOrPlaceholder(ref, domain, entities, placeholders)
          : resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Validates}--${predicate}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Validates,
          predicate,
        });
      }
    }

    // validates.ui.{screens,actions,navigation}[]
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
