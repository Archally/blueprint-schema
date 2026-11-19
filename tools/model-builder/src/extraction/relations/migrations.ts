import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveRef } from './resolver.js';

/**
 * What a migration connects to.
 *
 *   Migration --migration_depends_on-->       Migration   (`depends_on[]`, both documents)
 *   Migration --migration_relates_to_decision--> Decision (`related_decisions[]`, both documents)
 *   Migration --migration_affects-->          anything    (the derived `_affects` list)
 *   Migration --migration_in_change_stream--> ChangeStream (`change_stream_ref`, both documents)
 *
 * A dependency's stated reason rides on its `migration_depends_on` edge as `data.reason`, read from
 * the entry of `depends_on_reasons` that names the same migration. A dependency without such an
 * entry states no reason and its edge carries none; an entry naming a migration absent from
 * `depends_on` draws no edge of its own (semantic validation reports it), and when two entries name
 * one migration the first is carried. The team that carries a migration out (`owned_by`) is drawn
 * by the organizational ownership extractor, as for every other owned entity.
 *
 * ONLY DECLARED FIELDS. Two models in this corpus put `motivation_shift.goals_promoted`,
 * `organization_impact.ownership_after` and `scenario_refs` inside `migration.properties`, which is
 * the open `entity_properties` bag. Twenty-nine typed-looking references sit there and none of them
 * is schema. Deriving edges from an undeclared key makes that key load-bearing without the schema
 * having said so, and the next model that uses the same word for something else is silently wrong.
 *
 * NOTHING IS PLACEHOLDERED. Every other extractor mints a `Missing` node for a ref it cannot
 * resolve, and here that would be wrong twice over. A change program's `add` targets describe the
 * model AFTER the migration, so a target absent from the graph is the normal case rather than a
 * dangling reference; and one model's `scenario_refs` still names a band retired in v2.8.10, so a
 * placeholder would reintroduce exactly the orphan this step exists to remove. An unresolvable ref
 * produces no edge and no node.
 */
export function extractMigrationRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Migration) continue;
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;
    const domain = entityDomain(entity);

    const push = (
      type: string,
      refs: unknown,
      seen: Set<string>,
      dataOf: (ref: string) => Record<string, unknown> | undefined = () => undefined,
    ): void => {
      if (!Array.isArray(refs)) return;
      for (const ref of refs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveRef(ref, domain, entities);
        // Not a dangling reference: see the note above.
        if (!targetId || targetId === entity.id) continue;
        const id = `${entity.id}--${type}--${targetId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const edgeData = dataOf(ref);
        relations.push({
          id,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type,
          ...(edgeData ? { data: edgeData } : {}),
        });
      }
    };

    const reasons = dependencyReasons(data.depends_on_reasons);
    const seen = new Set<string>();
    push(RELATION_TYPE.MigrationDependsOn, data.depends_on, seen, (ref) => {
      const reason = reasons.get(ref);
      return reason === undefined ? undefined : { reason };
    });
    push(RELATION_TYPE.MigrationRelatesToDecision, data.related_decisions, seen);
    push(RELATION_TYPE.MigrationAffects, data._affects, seen);
    if (typeof data.change_stream_ref === 'string') {
      push(RELATION_TYPE.MigrationInChangeStream, [data.change_stream_ref], seen);
    }
  }

  return relations;
}

/**
 * The stated reason per waited-for migration, from `depends_on_reasons`. The first entry naming a
 * migration wins; a malformed entry names nothing.
 */
export function dependencyReasons(entries: unknown): Map<string, string> {
  const reasons = new Map<string, string>();
  if (!Array.isArray(entries)) return reasons;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const { migration, reason } = entry as Record<string, unknown>;
    if (typeof migration !== 'string' || typeof reason !== 'string') continue;
    if (reasons.has(migration)) continue;
    reasons.set(migration, reason);
  }
  return reasons;
}
