import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { resolveOrPlaceholder, entityDomain } from './resolver.js';

/**
 * Dynamics relations: every edge this layer implies, and all of them Dynamics -> Operation.
 *
 *   Parallelism    --parallelism_operation-->   Operation  (parallelism[].operations[])
 *   Ordering       --ordering_operation-->      Operation  (ordering[].operations[])
 *   Ordering       --ordering_requires-->       Operation  (ordering[].requires[])
 *   Ordering       --ordering_enables-->        Operation  (ordering[].enables[])
 *   Ordering       --ordering_parallel_with-->  Operation  (ordering[].can_parallel_with[])
 *   RaceCondition  --race_condition_affects-->  Operation | Concept  (race_conditions[].affects[])
 *
 * ## Why these edges are worth building rather than deferring
 *
 * Measured 2026-09-03 over the 39 corpus files: the layer carries **467 refs of which 463 resolve**
 * and none dangle. Extracting the entities without their edges would put 207 isolated nodes into
 * every graph view - the entities would be present and say nothing about anything, which is a
 * different failure from the one being fixed rather than a smaller amount of it.
 *
 * ## Which of these the validator already checks, and why the answer is arbitrary
 *
 * The validator's reference integrity reads a field when `isRefKey` recognises its NAME.
 * `operations` is in its `LIKELY_REF_KEYS`; `requires`, `enables`, `can_parallel_with` and
 * `affects` are not, and do not end in `_ref`/`_refs`. So 110 of the 467 are checked today and 357
 * are invisible - decided by spelling, not by meaning. The validator reads YAML directly and never
 * consults the model builder, so nothing here changes it.
 *
 * The largest blind field is `race_conditions[].affects[]`: 190 refs, every one well-formed and
 * resolvable, typed in the schema as a bare `type: string` array whose description asks the author
 * to "use operation_ref ... format for traceability". Prose reaches no consumer. Promoting it to a
 * typed ref is a schema change and belongs to the release, not here - but the edge is built either
 * way, because the data is already correct.
 *
 * ## The family discriminator
 *
 * All three families are `ENTITY_TYPE.Dynamics` (see `entities/dynamics.ts` for why), so the type
 * cannot say which family an entity belongs to. `_dynamics_family` carries it, and this extractor
 * reads that rather than guessing from the id prefix: a prefix is a convention the schema states
 * once and a model can spell scoped (`orders.PAR001`), which makes prefix-matching a second, weaker
 * implementation of a fact the entity already holds.
 */

/**
 * Field name to relation type, per family. Only fields that carry refs appear.
 *
 * Looked up with `Object.hasOwn` rather than by plain indexing. A `typeof family !== 'string'`
 * guard stood here first and was removed as dead - any non-string misses the table and is caught by
 * the `!fields` branch below - but removing it showed what it had NOT been covering: a family
 * spelled `constructor` or `toString` resolves through the prototype to a function, which is truthy
 * and then not iterable. `hasOwn` answers the question the code actually asks.
 */
const REF_FIELDS: Record<string, { field: string; type: string }[]> = {
  parallelism: [{ field: 'operations', type: RELATION_TYPE.ParallelismOperation }],
  ordering: [
    { field: 'operations', type: RELATION_TYPE.OrderingOperation },
    { field: 'requires', type: RELATION_TYPE.OrderingRequires },
    { field: 'enables', type: RELATION_TYPE.OrderingEnables },
    { field: 'can_parallel_with', type: RELATION_TYPE.OrderingParallelWith },
  ],
  'race-condition': [{ field: 'affects', type: RELATION_TYPE.RaceConditionAffects }],
};

/**
 * An `affects[]` entry is a free string by schema, so some carry prose around the id -
 * `"recruitment.CMD005 (SubmitApplication - write Application + ConsentRecord)"`. Four such entries
 * exist in the corpus, all under `resources`, but the field's type permits it anywhere.
 *
 * A leading id is read out; anything else is left alone rather than pattern-matched out of the
 * middle of a sentence. Extracting an id from arbitrary prose would build an edge from a guess, and
 * a wrong edge is worse than a missing one - it is indistinguishable from a declared fact.
 */
const LEADING_ID = /^(([a-z][a-z0-9-]*\.)?[A-Z]{1,4}\d{3,})\b/;

function refFromEntry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = LEADING_ID.exec(trimmed);
  return match ? match[1]! : null;
}

export function extractDynamicsRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Dynamics) continue;

    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;
    const family = data._dynamics_family;
    if (typeof family !== 'string' || !Object.hasOwn(REF_FIELDS, family)) continue;
    const fields = REF_FIELDS[family]!;

    const domain = entityDomain(entity);

    for (const { field, type } of fields) {
      const values = data[field];
      if (!Array.isArray(values)) continue;
      for (const raw of values) {
        const ref = refFromEntry(raw);
        if (!ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${type}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type,
        });
      }
    }
  }

  return relations;
}
