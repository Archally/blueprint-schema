import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE, type RelationType } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Forward ref-list fields on a leverage point (LP### → target). Each authored ref string
 * becomes one outbound relation whose source is the leverage point. Unresolvable refs
 * (e.g. FF### / FN### that the model-builder does not yet extract as first-class entities)
 * degrade to Missing placeholders, exactly like every other relation extractor.
 */
const LEVERAGE_REF_FIELDS: Array<[string, RelationType]> = [
  ['finding_refs', RELATION_TYPE.LeverageFinding],
  ['risk_refs', RELATION_TYPE.LeverageRisk],
  ['decision_refs', RELATION_TYPE.LeverageDecision],
  ['fitness_function_refs', RELATION_TYPE.LeverageFitnessFunction],
  ['migration_refs', RELATION_TYPE.LeverageMigration],
  ['realized_by', RELATION_TYPE.LeverageRealizedBy],
  ['advances_goals', RELATION_TYPE.LeverageAdvancesGoal],
  ['advances_value_streams', RELATION_TYPE.LeverageValueStream],
  ['capability_refs', RELATION_TYPE.LeverageCapability],
];

/** Push one relation per resolvable string ref in a ref-list field (source → target). */
function pushListRefs(
  relations: Relation[],
  sourceId: string,
  value: unknown,
  type: RelationType,
  domain: string,
  entities: Entity[],
  placeholders: Map<string, Entity>
): void {
  if (!Array.isArray(value)) return;
  for (const ref of value) {
    if (typeof ref !== 'string' || !ref) continue;
    const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
    relations.push({
      id: `${sourceId}--${type}--${targetId}`,
      source_entity_id: sourceId,
      target_entity_id: targetId,
      type,
    });
  }
}

/**
 * Extract outbound relations from LeveragePoint entities (LP###, v2.7.4).
 *
 *   Address (AS-IS)  : finding_refs / risk_refs / decision_refs / fitness_function_refs
 *   Deliver (TO-BE)  : migration_refs / realized_by (WI###)
 *   Strategic intent : advances_goals / advances_value_streams / capability_refs
 *   Leverage DAG     : depends_on[] + enables[] → a single LeverageDependsOn edge
 *                      (dependent → prerequisite).
 *
 * `enables` is the authored inverse of `depends_on`, so it is folded into the SAME edge
 * type with its direction flipped ("A enables B" ⇒ "B depends_on A"). Dedup-by-id in
 * buildRelations() then collapses the case where both sides declare the same edge, leaving
 * a clean single-direction DAG for the interactive leverage view (no double edges).
 */
export function extractLeverageRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.LeveragePoint) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // Forward ref-list fields (source = this leverage point).
    for (const [field, type] of LEVERAGE_REF_FIELDS) {
      pushListRefs(relations, entity.id, data[field], type, domain, entities, placeholders);
    }

    // Leverage DAG — depends_on: this LP → prerequisite LP.
    pushListRefs(
      relations,
      entity.id,
      data.depends_on,
      RELATION_TYPE.LeverageDependsOn,
      domain,
      entities,
      placeholders
    );

    // Leverage DAG — enables (inverse edge): "this LP enables X" ⇒ "X depends_on this LP",
    // so emit (X → this LP). Dedup collapses it when X also declares depends_on.
    const enables = data.enables;
    if (Array.isArray(enables)) {
      for (const ref of enables) {
        if (typeof ref !== 'string' || !ref) continue;
        const enabledId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${enabledId}--${RELATION_TYPE.LeverageDependsOn}--${entity.id}`,
          source_entity_id: enabledId,
          target_entity_id: entity.id,
          type: RELATION_TYPE.LeverageDependsOn,
        });
      }
    }
  }

  return relations;
}
