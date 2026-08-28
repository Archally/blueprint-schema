import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain } from './resolver.js';
import { buildOperationKeyIndex, resolveOperationRefOrPlaceholder } from './operationRef.js';

/**
 * Extract contract → operation relations from arch Contract entities.
 *
 * Service contracts reference domain operations via typed operation_refs, wiring the
 * design/arch plane to the design/domain plane so an operation's transport surface is
 * queryable (e.g. an exposed operation should declare an `exchange` binding):
 *
 *   - expose[]  (openapi / rpc)      operations this service exposes    → ContractExposes
 *   - call[]    (http-client / rpc)  operations this service calls      → ContractCalls
 *   - send[]    (channel / AsyncAPI) operations this service publishes  → ContractSends
 *   - receive[] (channel / AsyncAPI) operations this service consumes   → ContractReceives
 *
 * Each operation_ref is resolved in BOTH formats the schema documents - the ID-based
 * "orders.CMD001" and the human-readable "orders:placeOrder" (see `operationRef.ts`, which explains
 * why the second lives there and not in the generic `resolveRef`). Genuinely unresolvable refs
 * become shared Missing placeholders, as elsewhere.
 *
 * Format 2 was unimplemented until 2026-08-27, and the cost was not a missing edge but a blind gate:
 * prestashop wires all 38 of its contracts that way, so `contract-operation-missing-exchange` -
 * which fires only for contract-wired operations - reported zero on a model with zero exchange
 * blocks. realestate-en, which writes format 1, had working `contract_sends` / `contract_receives`
 * edges the whole time, so the extractor was never the suspect.
 *
 * `handled_by` (membership.ts) is *derived* from expose ∪ send and was already materialized —
 * these are the underlying edges it derives from. Without them a contract-wired operation had no
 * incoming edge from its contract, so `orphan-entities` counted contracts as unreferenced.
 * Ported from the public `tools/model-builder/src/extraction/relations/archContracts.ts`; keep the
 * two in lockstep (both stacks run one shared semantic-rule pack).
 */
const CONTRACT_VERBS: ReadonlyArray<{ field: string; type: string }> = [
  { field: 'expose', type: RELATION_TYPE.ContractExposes },
  { field: 'call', type: RELATION_TYPE.ContractCalls },
  { field: 'send', type: RELATION_TYPE.ContractSends },
  { field: 'receive', type: RELATION_TYPE.ContractReceives },
];

export function extractArchContractRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>,
): Relation[] {
  const relations: Relation[] = [];
  const keyIndex = buildOperationKeyIndex(entities);

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
        const targetId = resolveOperationRefOrPlaceholder(ref, domain, entities, placeholders, keyIndex);
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
