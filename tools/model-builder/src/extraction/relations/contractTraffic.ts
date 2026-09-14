import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Which bounded contexts actually talk to each other, over what protocol, and across how many
 * operations - computed from the contract refs a model already authors.
 *
 * A declared `dependency` entry says THAT A depends on B. It cannot say how, which way, how much,
 * or over which broker, and in this corpus it usually does not try: `type` is a free string
 * carrying six spellings for three concepts. The contract surface answers all four, because a
 * service that exposes an operation and a service that calls the same operation are, between them,
 * a statement about traffic.
 *
 * DERIVATION IS A SECOND SOURCE, NEVER THE ONLY ONE. It reaches far fewer pairs than declaration
 * does, and in a model whose contracts wire nothing it reaches none at all: most models arrive here
 * with a context map and no contract surface behind it. A derivation that finds nothing does not
 * fail, it returns the empty set - which
 * is indistinguishable from "there is nothing there". So this edge sits BESIDE
 * `context_depends_on` and never replaces it; a pair with one and not the other is a finding for a
 * reader to judge, not a contradiction for a builder to resolve.
 *
 * THE PATH, all of it over edges this builder already emits:
 *   Context --contains--> Service --provides--> Contract --expose|send|provide|write--> Operation
 *   Context --contains--> Service --provides--> Contract --call|receive|consume|read--> Operation
 * One path, not two. A Contract entity is built for every key under `contracts:`, so the couplings
 * that cross no wire arrive on the same walk; what separates them is the protocol their kind maps
 * to, and a protocol mismatch already fails the join below.
 * An operation with a provider and a consumer in DIFFERENT contexts is one unit of traffic, drawn
 * from the consumer to the provider, which is the direction a call travels.
 *
 * WHY THERE IS NO `match` ON THIS EDGE. `handled_by` carries one, because membership resolves an
 * operation ref by exact id and then by a looser fold - case, scope and camelCase - and an edge
 * resting on the fold is a weaker claim. This path has no fold: `archContracts` resolves a ref
 * through the two formats the schema documents and emits nothing where neither matches, so every
 * contributing edge is exact by construction. A `match` field here would be a constant wearing the
 * shape of a measurement.
 */

/** A contract kind, as authored, mapped to the protocol it speaks. */
const PROTOCOL_BY_CONTRACT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  openapi: 'http',
  httpClient: 'http',
  http_client: 'http',
  asyncapi: 'message',
  channel: 'message',
  openrpc: 'rpc',
  // The three that cross no wire speak themselves: the kind IS the protocol, because there is no
  // wire whose name could stand in for it.
  inprocess: 'inprocess',
  shareddata: 'shareddata',
  scheduledtransfer: 'scheduledtransfer',
});

/** Verbs that make a contract's service the PROVIDER of the operation. */
const PROVIDER_VERBS: ReadonlySet<string> = new Set([
  RELATION_TYPE.ContractExposes,
  RELATION_TYPE.ContractSends,
  RELATION_TYPE.ContractProvides,
  // The writer is the provider on both data kinds even though it calls nobody: it owns the schema,
  // and the reader is bound to it without being asked. The edge runs reader to writer for the same
  // reason a call edge runs caller to callee - it points at what the other end depends on.
  RELATION_TYPE.ContractWrites,
]);

/** Verbs that make a contract's service the CONSUMER of the operation. */
const CONSUMER_VERBS: ReadonlySet<string> = new Set([
  RELATION_TYPE.ContractCalls,
  RELATION_TYPE.ContractReceives,
  RELATION_TYPE.ContractConsumes,
  RELATION_TYPE.ContractReads,
]);

interface Side {
  contextId: string;
  protocol: string;
  brokerId: string | null;
}

interface TrafficAccumulator {
  protocols: Set<string>;
  operations: Set<string>;
  brokerIds: Set<string>;
}

function protocolOf(contract: Entity): string | null {
  const type = (contract.data as { _contractType?: unknown } | undefined)?._contractType;
  if (typeof type !== 'string') return null;
  return PROTOCOL_BY_CONTRACT_TYPE[type] ?? null;
}

function brokerOf(contract: Entity): string | null {
  const broker = (contract.data as { brokerId?: unknown } | undefined)?.brokerId;
  return typeof broker === 'string' && broker.length > 0 ? broker : null;
}

export function extractContractTrafficRelations(
  entities: Entity[],
  relations: Relation[],
): Relation[] {
  const contracts = new Map<string, Entity>();
  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.Contract) contracts.set(entity.id, entity);
  }
  if (contracts.size === 0) return [];

  const contexts = new Set(
    entities.filter((e) => e.type === ENTITY_TYPE.Context).map((e) => e.id),
  );
  const services = new Set(
    entities.filter((e) => e.type === ENTITY_TYPE.Service).map((e) => e.id),
  );
  if (contexts.size === 0 || services.size === 0) return [];

  // Service -> the context that contains it, and Contract -> the service that provides it.
  const contextByService = new Map<string, string>();
  const serviceByContract = new Map<string, string>();
  for (const relation of relations) {
    if (relation.type === RELATION_TYPE.Contains) {
      if (contexts.has(relation.source_entity_id) && services.has(relation.target_entity_id)) {
        contextByService.set(relation.target_entity_id, relation.source_entity_id);
      }
    } else if (relation.type === RELATION_TYPE.Provides) {
      if (services.has(relation.source_entity_id) && contracts.has(relation.target_entity_id)) {
        serviceByContract.set(relation.target_entity_id, relation.source_entity_id);
      }
    }
  }

  function sideOf(contractId: string): Side | null {
    const contract = contracts.get(contractId);
    if (!contract) return null;
    const serviceId = serviceByContract.get(contractId);
    if (!serviceId) return null;
    const contextId = contextByService.get(serviceId);
    if (!contextId) return null;
    const protocol = protocolOf(contract);
    if (!protocol) return null;
    return { contextId, protocol, brokerId: brokerOf(contract) };
  }

  // operation -> who provides it and who consumes it, per protocol.
  const providers = new Map<string, Side[]>();
  const consumers = new Map<string, Side[]>();
  for (const relation of relations) {
    const provider = PROVIDER_VERBS.has(relation.type);
    const consumer = !provider && CONSUMER_VERBS.has(relation.type);
    if (!provider && !consumer) continue;
    const side = sideOf(relation.source_entity_id);
    if (!side) continue;
    const target = provider ? providers : consumers;
    const bucket = target.get(relation.target_entity_id);
    if (bucket) bucket.push(side);
    else target.set(relation.target_entity_id, [side]);
  }

  // The join: one unit of traffic per operation a consumer calls and a provider exposes.
  const traffic = new Map<string, TrafficAccumulator>();
  for (const [operationId, consumerSides] of consumers) {
    const providerSides = providers.get(operationId);
    if (!providerSides) continue;
    for (const consumer of consumerSides) {
      for (const provider of providerSides) {
        // A protocol mismatch is not traffic: an HTTP caller and a message producer of the same
        // operation describe two surfaces, not one exchange.
        if (consumer.protocol !== provider.protocol) continue;
        // A context calling its own service is internal, and drawing it as an arrow to itself
        // says nothing a reader of a context map wants.
        if (consumer.contextId === provider.contextId) continue;
        const key = `${consumer.contextId} ${provider.contextId}`;
        let accumulated = traffic.get(key);
        if (!accumulated) {
          accumulated = { protocols: new Set(), operations: new Set(), brokerIds: new Set() };
          traffic.set(key, accumulated);
        }
        accumulated.protocols.add(consumer.protocol);
        accumulated.operations.add(operationId);
        // The broker comes from the PROVIDER, never synthesised - the same rule the contract
        // surface states, because the consumer's own contract need not name one.
        if (provider.brokerId) accumulated.brokerIds.add(provider.brokerId);
      }
    }
  }

  const out: Relation[] = [];
  for (const [key, accumulated] of traffic) {
    const [consumerId, providerId] = key.split(' ');
    if (!consumerId || !providerId) continue;
    const operations = [...accumulated.operations].sort();
    out.push({
      id: `${consumerId}--${RELATION_TYPE.ContractTraffic}--${providerId}`,
      source_entity_id: consumerId,
      target_entity_id: providerId,
      type: RELATION_TYPE.ContractTraffic,
      data: {
        resolution: 'contract',
        protocols: [...accumulated.protocols].sort(),
        operations,
        operation_count: operations.length,
        broker_ids: [...accumulated.brokerIds].sort(),
      },
    });
  }

  return out;
}
