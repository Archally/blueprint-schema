import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract contract → operation relations from arch Contract entities.
 *
 * Service contracts reference domain operations via typed operation_refs, wiring the
 * design/arch plane to the design/domain plane so an operation's transport surface is
 * queryable (e.g. an exposed operation should declare an `exchange` binding):
 *
 *   - expose[]  (openapi / rpc)     operations this service exposes    → ContractExposes
 *   - call[]    (http-client / rpc) operations this service calls      → ContractCalls
 *   - send[]    (channel / AsyncAPI) operations this service publishes → ContractSends
 *   - receive[] (channel / AsyncAPI) operations this service consumes  → ContractReceives
 *
 * Each operation_ref is an ID-based ref ("orders.CMD001") resolved against operation
 * entities; unresolvable refs become shared Missing placeholders (as elsewhere).
 */
const CONTRACT_VERBS: ReadonlyArray<{ field: string; type: string }> = [
  { field: 'expose', type: RELATION_TYPE.ContractExposes },
  { field: 'call', type: RELATION_TYPE.ContractCalls },
  { field: 'send', type: RELATION_TYPE.ContractSends },
  { field: 'receive', type: RELATION_TYPE.ContractReceives },
];

export function extractArchContractRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Contract) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    for (const { field, type } of CONTRACT_VERBS) {
      const refs = data[field];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref !== 'string' || !ref) continue;
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
