import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract relations from UI entities:
 * - Screen → Model (uses_models[])
 * - Screen → Goal (motivated_by[])
 * - Screen → Decision (decisions[])
 * - Screen → Test (validated_by[])
 * - Screen → Story (stories[])
 * - Action → Screen (screen ref)
 * - Action → Operation (triggers_operations[])
 * - Navigation → Screen (from, to)
 */
export function extractUIRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    if (entity.type === ENTITY_TYPE.Screen) {
      // Screen → Model (uses_models[])
      const models = data.uses_models as string[] | undefined;
      if (Array.isArray(models)) {
        for (const ref of models) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.ScreenUsesModel}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.ScreenUsesModel,
          });
        }
      }

      // Screen → Goal (motivated_by[])
      const goals = data.motivated_by as string[] | undefined;
      if (Array.isArray(goals)) {
        for (const ref of goals) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.ScreenMotivatedBy}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.ScreenMotivatedBy,
          });
        }
      }

      // Screen → Decision (decisions[])
      const decisions = data.decisions as string[] | undefined;
      if (Array.isArray(decisions)) {
        for (const ref of decisions) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.ScreenDecision}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.ScreenDecision,
          });
        }
      }

      // Screen → Test (validated_by[])
      const tests = data.validated_by as string[] | undefined;
      if (Array.isArray(tests)) {
        for (const ref of tests) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.ScreenValidatedBy}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.ScreenValidatedBy,
          });
        }
      }

      // Screen → Story (stories[])
      const stories = data.stories as string[] | undefined;
      if (Array.isArray(stories)) {
        for (const ref of stories) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.ScreenStory}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.ScreenStory,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.UIAction) {
      // Action → Screen (screen ref)
      const screenRef = data.screen as string | undefined;
      if (typeof screenRef === 'string' && screenRef) {
        const targetId = resolveOrPlaceholder(screenRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.ActionOnScreen}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.ActionOnScreen,
        });
      }

      // Action → Operation (triggers_operations[])
      const ops = data.triggers_operations as string[] | undefined;
      if (Array.isArray(ops)) {
        for (const ref of ops) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.ActionTriggersOperation}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.ActionTriggersOperation,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.UINavigation) {
      // Navigation → Screen (from)
      const fromRef = data.from as string | undefined;
      if (typeof fromRef === 'string' && fromRef) {
        const targetId = resolveOrPlaceholder(fromRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.NavFrom}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.NavFrom,
        });
      }

      // Navigation → Screen (to)
      const toRef = data.to as string | undefined;
      if (typeof toRef === 'string' && toRef) {
        const targetId = resolveOrPlaceholder(toRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.NavTo}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.NavTo,
        });
      }
    }
  }

  return relations;
}
