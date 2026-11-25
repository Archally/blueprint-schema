import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE, type RelationType } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder, resolveRef } from './resolver.js';

/**
 * Forward ref-list fields on a leverage point (LP### → target). Each authored ref string
 * becomes one outbound relation whose source is the leverage point. An unresolvable ref degrades
 * to a Missing placeholder, exactly like every other relation extractor.
 *
 * Every target type this list names is extracted as a first-class entity, so a Missing here means
 * the ref is wrong rather than that the type is unknown.
 */
const LEVERAGE_REF_FIELDS: Array<[string, RelationType]> = [
  ['finding_refs', RELATION_TYPE.LeverageFinding],
  ['risk_refs', RELATION_TYPE.LeverageRisk],
  ['decision_refs', RELATION_TYPE.LeverageDecision],
  ['fitness_function_refs', RELATION_TYPE.LeverageFitnessFunction],
  ['realized_by', RELATION_TYPE.LeverageRealizedBy],
  ['advances_goals', RELATION_TYPE.LeverageAdvancesGoal],
  ['advances_value_streams', RELATION_TYPE.LeverageValueStream],
  ['capability_refs', RELATION_TYPE.LeverageCapability],
];

/** The ref lists of a watch item (WCH###) drawn as edges: its risks, findings and decisions. */
const WATCH_ITEM_REF_FIELDS: Array<[string, RelationType]> = [
  ['risk_refs', RELATION_TYPE.WatchItemRisk],
  ['finding_refs', RELATION_TYPE.WatchItemFinding],
  ['decision_refs', RELATION_TYPE.WatchItemDecision],
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
 *   Deliver (TO-BE)  : realized_by (WI###), plus migration links read from both ends
 *   Strategic intent : advances_goals / advances_value_streams / capability_refs
 *   Leverage DAG     : depends_on[] → one LeverageDependsOn edge per prerequisite
 *                      (dependent → prerequisite).
 *
 * A leverage dependency is stated once, on the dependent. What a leverage point unblocks is the
 * same relation read in the other direction, so it is answered from these edges and never read
 * from the point that is depended on.
 */
export function extractLeverageRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];
  // Read both ends together before the graph-wide deduplication, preserving their provenance.
  const migrationLinks = new Map<string, Relation>();
  const leverageIds = new Set(entities.filter((entity) => entity.type === ENTITY_TYPE.LeveragePoint).map((entity) => entity.id));
  const addMigrationLink = (migrationId: string, leverageId: string, provenance: 'migration' | 'leverage-point'): void => {
    const type = RELATION_TYPE.MigrationServesLeverage;
    const id = `${migrationId}--${type}--${leverageId}`;
    const existing = migrationLinks.get(id);
    if (existing) {
      if (existing.data?.provenance !== provenance) existing.data = { provenance: 'both' };
      return;
    }
    migrationLinks.set(id, {
      id, source_entity_id: migrationId, target_entity_id: leverageId, type, data: { provenance },
    });
  };
  for (const migration of entities) {
    if (migration.type !== ENTITY_TYPE.Migration) continue;
    const leverageReferences = migration.data?.leverage_refs;
    if (!Array.isArray(leverageReferences)) continue;
    for (const reference of leverageReferences) {
      if (typeof reference !== 'string') continue;
      const leverageId = resolveRef(reference, entityDomain(migration), entities);
      if (!leverageId) continue;
      if (!leverageIds.has(leverageId)) continue;
      addMigrationLink(migration.id, leverageId, 'migration');
    }
  }

  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.WatchItem) {
      const watched = entity.data as Record<string, unknown> | undefined;
      for (const [field, type] of WATCH_ITEM_REF_FIELDS) {
        pushListRefs(relations, entity.id, watched?.[field], type, entityDomain(entity), entities, placeholders);
      }
      continue;
    }
    if (entity.type !== ENTITY_TYPE.LeveragePoint) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    if (Array.isArray(data.migration_refs)) {
      for (const ref of new Set(data.migration_refs)) {
        if (typeof ref !== 'string' || !ref) continue;
        const migrationId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        addMigrationLink(migrationId, entity.id, 'leverage-point');
      }
    }

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
  }

  return [...relations, ...migrationLinks.values()];
}
