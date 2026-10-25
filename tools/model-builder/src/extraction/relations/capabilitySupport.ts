import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { resolveRefDetailed } from './resolver.js';

/**
 * Which processes and use cases support each capability, lifted from the operations they hold.
 *
 * A process supports a capability when at least one operation it orders (`process_orders_operation`)
 * is realized by that capability (`capability_operation`); a use case, when at least one operation
 * its main scenario or alternative flows name (`use_case_operation`) is. One edge per
 * (process or use case, capability) pair, never one per operation, with:
 *
 *   - `operation_count`: the distinct operations it holds that the capability realizes;
 *   - `operation_total`: the distinct operations it holds, realized by any capability or by none;
 *   - `origins`: the sorted distinct `origin` values (`module`, `operation`) of the contributing
 *     `capability_operation` edges;
 *   - `via_trigger` (process only): whether the operation its `trigger` names is one of the
 *     contributing operations.
 *
 * Both counts are over distinct resolved Operation targets: an operation the process orders twice
 * counts once, and a step whose reference resolves to no operation counts in neither. The shares
 * of one process across capabilities may overlap - an operation realized by two capabilities counts
 * for both - so they are not a partition and do not sum to the total.
 *
 * Not credited: an operation a process names only in its trigger (it orders no step there), the
 * operations of a subprocess the process calls, and, for a use case, the operations of the
 * processes it lists. Each statement supports the capabilities its own operations reach.
 *
 * Reads the finished `capability_operation` edges, so it runs after them; the output is sorted by
 * edge id and does not depend on the order entities or relations were produced in.
 */
export function extractCapabilitySupportRelations(entities: Entity[], relations: Relation[]): Relation[] {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const typeById = new Map(entities.map((entity) => [entity.id, entity.type]));
  const isOperation = (id: string) => typeById.get(id) === ENTITY_TYPE.Operation;

  // operation -> capability -> origin of the one edge for that pair.
  const capabilitiesByOperation = new Map<string, Map<string, string>>();
  for (const relation of relations) {
    if (relation.type !== RELATION_TYPE.CapabilityOperation) continue;
    if (typeById.get(relation.source_entity_id) !== ENTITY_TYPE.Capability) continue;
    if (!isOperation(relation.target_entity_id)) continue;
    const origin = (relation.data as { origin?: unknown } | undefined)?.origin;
    const bucket = capabilitiesByOperation.get(relation.target_entity_id) ?? new Map<string, string>();
    bucket.set(relation.source_entity_id, typeof origin === 'string' ? origin : 'operation');
    capabilitiesByOperation.set(relation.target_entity_id, bucket);
  }
  if (capabilitiesByOperation.size === 0) return [];

  const operationsOf = (type: string, sourceType: string): Map<string, Set<string>> => {
    const bySource = new Map<string, Set<string>>();
    for (const relation of relations) {
      if (relation.type !== type) continue;
      if (typeById.get(relation.source_entity_id) !== sourceType) continue;
      if (!isOperation(relation.target_entity_id)) continue;
      const bucket = bySource.get(relation.source_entity_id) ?? new Set<string>();
      bucket.add(relation.target_entity_id);
      bySource.set(relation.source_entity_id, bucket);
    }
    return bySource;
  };

  const out: Relation[] = [];

  for (const [processId, operations] of operationsOf(RELATION_TYPE.ProcessOrdersOperation, ENTITY_TYPE.Process)) {
    const trigger = triggerOperation(entities, entityById, processId);
    for (const support of supportOf(operations, capabilitiesByOperation)) {
      out.push({
        id: `${processId}--${RELATION_TYPE.ProcessSupportsCapability}--${support.capabilityId}`,
        source_entity_id: processId,
        target_entity_id: support.capabilityId,
        type: RELATION_TYPE.ProcessSupportsCapability,
        data: {
          operation_count: support.operations.size,
          operation_total: operations.size,
          origins: support.origins,
          via_trigger: trigger !== undefined && support.operations.has(trigger),
        },
      });
    }
  }

  for (const [useCaseId, operations] of operationsOf(RELATION_TYPE.UseCaseOperation, ENTITY_TYPE.UseCase)) {
    for (const support of supportOf(operations, capabilitiesByOperation)) {
      out.push({
        id: `${useCaseId}--${RELATION_TYPE.UseCaseSupportsCapability}--${support.capabilityId}`,
        source_entity_id: useCaseId,
        target_entity_id: support.capabilityId,
        type: RELATION_TYPE.UseCaseSupportsCapability,
        data: {
          operation_count: support.operations.size,
          operation_total: operations.size,
          origins: support.origins,
        },
      });
    }
  }

  return out.sort((a, b) => compare(a.id, b.id));
}

interface Support {
  capabilityId: string;
  operations: Set<string>;
  origins: string[];
}

/** Every capability the given operations reach, with the operations and origins that reach it. */
function supportOf(operations: Set<string>, capabilitiesByOperation: Map<string, Map<string, string>>): Support[] {
  const byCapability = new Map<string, { operations: Set<string>; origins: Set<string> }>();
  for (const operationId of operations) {
    for (const [capabilityId, origin] of capabilitiesByOperation.get(operationId) ?? []) {
      const bucket = byCapability.get(capabilityId) ?? { operations: new Set<string>(), origins: new Set<string>() };
      bucket.operations.add(operationId);
      bucket.origins.add(origin);
      byCapability.set(capabilityId, bucket);
    }
  }
  return [...byCapability].map(([capabilityId, bucket]) => ({
    capabilityId,
    operations: bucket.operations,
    origins: [...bucket.origins].sort(compare),
  }));
}

/**
 * The Operation a process's `trigger.operation` names, resolved by the same shared rule its steps
 * are, or undefined where it names none, several entities, or something that is not an operation.
 */
function triggerOperation(entities: Entity[], entityById: Map<string, Entity>, processId: string): string | undefined {
  const process = entityById.get(processId);
  const trigger = (process?.data as { trigger?: unknown } | undefined)?.trigger;
  const ref = trigger && typeof trigger === 'object' ? (trigger as { operation?: unknown }).operation : undefined;
  if (typeof ref !== 'string' || ref.length === 0) return undefined;
  const resolution = resolveRefDetailed(ref, entities);
  if (resolution.status !== 'resolved') return undefined;
  return entityById.get(resolution.handle)?.type === ENTITY_TYPE.Operation ? resolution.handle : undefined;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
