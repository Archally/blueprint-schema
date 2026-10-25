import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder, entityDomain, resolveOrPlaceholder } from './resolver.js';
import { indexDeclarations, resolveReference, type RefDeclaration, type RefIndex } from './refResolution.js';
import { buildOperationKeyIndex, resolveOperationRefOrPlaceholder } from './operationRef.js';

/**
 * Extract the declared outbound relations of Capability entities:
 * - capability.goal_refs[]   -> CapabilityGoal       (capability -> goal)
 * - capability.realized_in[] -> CapabilityRealizedIn (capability -> Domain or Context)
 *
 * The effective capability-to-operation attribution is NOT here: it joins `realized_in` with the
 * finished `handled_by` and `operation_in_domain` edges, so it runs in the second pass
 * (`extractCapabilityOperationRelations`, below).
 */
export function extractCapabilityRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];
  const moduleIndex = buildModuleIndex(entities);

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Capability) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    const goalRefs = data.goal_refs as string[] | undefined;
    if (Array.isArray(goalRefs)) {
      for (const ref of goalRefs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.CapabilityGoal}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.CapabilityGoal,
        });
      }
    }

    for (const ref of realizationRefs(data)) {
      const resolution = resolveReference(moduleIndex, ref);
      let targetId: string;
      if (resolution.status === 'resolved') {
        targetId = resolution.handle;
      } else {
        // The validator reports an id nothing declares as a cross-reference error; the graph keeps
        // the statement visible as a Missing placeholder, the way an unresolved `goal_refs` entry is.
        const placeholder = createPlaceholder(ref, resolution.status === 'ambiguous' ? resolution.handles : undefined);
        if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
        targetId = placeholder.id;
      }
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.CapabilityRealizedIn}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.CapabilityRealizedIn,
      });
    }
  }

  return relations;
}

/**
 * Which operations realize each capability: one `capability_operation` edge per effective
 * (capability, operation) attribution, computed from two statements at two grains.
 *
 *   1. STATED. Every entry of a capability's `operations` is an edge with `origin: 'operation'`.
 *      An operation that at least one capability lists, and that resolves to exactly one Operation,
 *      takes its capabilities from the listings ALONE, model-wide: no module default adds another,
 *      whichever capability names that module. An unresolved or ambiguous entry keeps its edge, to a
 *      Missing placeholder, and suppresses nothing - it names no operation to suppress.
 *
 *   2. MODULE DEFAULT. For every operation no capability lists, one edge from each capability whose
 *      `realized_in` names the operation's domain (its `operation_in_domain` edge) or a context that
 *      handles it (any `handled_by` edge), with `origin: 'module'`. A pair reached through several
 *      modules is ONE edge: `data.modules` lists every matching module's declared id, sorted, and
 *      `data.module` / `data.module_kind` name the first of them.
 *
 * No inheritance between a capability and its children or parent: each derives from its own
 * `realized_in` and `operations`. A model that states no `realized_in` gets exactly its listings.
 *
 * Reads the FINISHED binding, so it belongs after `applyDomainHopTier`; output is sorted by edge id
 * so it does not depend on the order entities or relations were produced in.
 */
export function extractCapabilityOperationRelations(
  entities: Entity[],
  relations: Relation[],
  placeholders: Map<string, Entity>
): Relation[] {
  const capabilities = entities
    .filter((entity) => entity.type === ENTITY_TYPE.Capability)
    .sort((a, b) => compare(a.id, b.id));
  if (capabilities.length === 0) return [];

  const operationIds = new Set(entities.filter((e) => e.type === ENTITY_TYPE.Operation).map((e) => e.id));
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const keyIndex = buildOperationKeyIndex(entities);
  const out = new Map<string, Relation>();

  // 1. Stated listings.
  const listed = new Set<string>();
  for (const capability of capabilities) {
    const data = capability.data as Record<string, unknown> | undefined;
    const refs = Array.isArray(data?.operations) ? (data!.operations as unknown[]) : [];
    for (const ref of new Set(refs)) {
      if (typeof ref !== 'string' || !ref) continue;
      const targetId = resolveOperationRefOrPlaceholder(ref, entityDomain(capability), entities, placeholders, keyIndex);
      if (operationIds.has(targetId)) listed.add(targetId);
      const id = `${capability.id}--${RELATION_TYPE.CapabilityOperation}--${targetId}`;
      if (out.has(id)) continue;
      out.set(id, {
        id,
        source_entity_id: capability.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.CapabilityOperation,
        data: { origin: 'operation' },
      });
    }
  }

  // 2. Module defaults, for operations no listing claims.
  const moduleIndex = buildModuleIndex(entities);
  const moduleById = new Map<string, { declaredId: string; kind: 'domain' | 'context' }>();
  const capabilitiesByModule = new Map<string, string[]>();
  for (const capability of capabilities) {
    const data = capability.data as Record<string, unknown> | undefined;
    if (!data) continue;
    for (const ref of realizationRefs(data)) {
      const resolution = resolveReference(moduleIndex, ref);
      if (resolution.status !== 'resolved') continue;
      const module = entityById.get(resolution.handle)!;
      moduleById.set(module.id, { declaredId: ref, kind: module.type === ENTITY_TYPE.Domain ? 'domain' : 'context' });
      const bucket = capabilitiesByModule.get(module.id) ?? [];
      if (!bucket.includes(capability.id)) bucket.push(capability.id);
      capabilitiesByModule.set(module.id, bucket);
    }
  }
  if (capabilitiesByModule.size === 0) return sorted(out);

  // operation -> every realizing module it belongs to: its domain and each context that handles it.
  const modulesByOperation = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relation.type !== RELATION_TYPE.OperationInDomain && relation.type !== RELATION_TYPE.HandledBy) continue;
    if (!capabilitiesByModule.has(relation.target_entity_id)) continue;
    if (!operationIds.has(relation.source_entity_id) || listed.has(relation.source_entity_id)) continue;
    const bucket = modulesByOperation.get(relation.source_entity_id) ?? new Set<string>();
    bucket.add(relation.target_entity_id);
    modulesByOperation.set(relation.source_entity_id, bucket);
  }

  for (const [operationId, modules] of modulesByOperation) {
    // capability -> the declared ids of the modules that attribute this operation to it.
    const viaModules = new Map<string, Set<string>>();
    for (const moduleId of modules) {
      for (const capabilityId of capabilitiesByModule.get(moduleId) ?? []) {
        const bucket = viaModules.get(capabilityId) ?? new Set<string>();
        bucket.add(moduleId);
        viaModules.set(capabilityId, bucket);
      }
    }
    for (const [capabilityId, moduleIds] of viaModules) {
      const named = [...moduleIds]
        .map((moduleId) => moduleById.get(moduleId)!)
        .sort((a, b) => compare(a.declaredId, b.declaredId));
      const id = `${capabilityId}--${RELATION_TYPE.CapabilityOperation}--${operationId}`;
      out.set(id, {
        id,
        source_entity_id: capabilityId,
        target_entity_id: operationId,
        type: RELATION_TYPE.CapabilityOperation,
        data: {
          origin: 'module',
          module: named[0]!.declaredId,
          module_kind: named[0]!.kind,
          modules: [...new Set(named.map((entry) => entry.declaredId))],
        },
      });
    }
  }

  return sorted(out);
}

/** A capability's `realized_in` entries: distinct non-empty strings, as written. */
function realizationRefs(data: Record<string, unknown>): string[] {
  const refs = data.realized_in;
  if (!Array.isArray(refs)) return [];
  return [...new Set(refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0))];
}

/**
 * Every Domain and Context by the id it was declared with (`DMN001`, `BC001`, `billing.BC002`). A
 * context's entity `displayId` is its name, so the generic resolver cannot reach it by its arch id;
 * this index can, and by the shared exact-string rule.
 */
function buildModuleIndex(entities: Entity[]): RefIndex {
  const declarations: RefDeclaration[] = [];
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Domain && entity.type !== ENTITY_TYPE.Context) continue;
    const authored = (entity.data as { id?: unknown } | undefined)?.id;
    if (typeof authored === 'string') declarations.push({ id: authored, handle: entity.id });
  }
  return indexDeclarations(declarations);
}

function sorted(relations: Map<string, Relation>): Relation[] {
  return [...relations.values()].sort((a, b) => compare(a.id, b.id));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
