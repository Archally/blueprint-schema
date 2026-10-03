import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { indexDeclarations, resolveReference, type RefDeclaration } from './refResolution.js';

/**
 * Extract structural containment relations from arch entities.
 * These are not ref-based — they derive from the YAML nesting hierarchy
 * preserved via _party, _context, _service fields in entity.data. A root-declared context and
 * everything under it carry `_root` instead of `_party`, and key on an empty party segment.
 *
 * - Context → Service (contains)
 * - Service → Contract (provides)
 */
function envelopeOf(data: Record<string, unknown> | undefined): string | undefined {
  if (typeof data?._party === 'string') return data._party;
  return data?._root === true ? '' : undefined;
}
export function extractArchRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  // Build lookup indexes keyed by structural coordinates so we can find
  // parent entities for each service and contract in O(1).
  const contextIndex = new Map<string, string>(); // "{fileOrigin}|{party}|{context}" → entity id
  const serviceIndex = new Map<string, string>(); // "{fileOrigin}|{party}|{context}|{service}" → entity id

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;
    if (entity.type === ENTITY_TYPE.Context) {
      const party = envelopeOf(data);
      if (party !== undefined) {
        const key = `${entity.fileOrigin ?? ''}|${party}|${entity.displayId}`;
        contextIndex.set(key, entity.id);
      }
    }
    if (entity.type === ENTITY_TYPE.Service) {
      const party = envelopeOf(data);
      const context = data?._context as string | undefined;
      if (party !== undefined && context) {
        const key = `${entity.fileOrigin ?? ''}|${party}|${context}|${entity.displayId}`;
        serviceIndex.set(key, entity.id);
      }
    }
  }

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;

    if (entity.type === ENTITY_TYPE.Service) {
      const party = envelopeOf(data);
      const context = data?._context as string | undefined;
      if (party === undefined || !context) continue;
      const contextKey = `${entity.fileOrigin ?? ''}|${party}|${context}`;
      const contextId = contextIndex.get(contextKey);
      if (!contextId) continue;
      relations.push({
        id: `${contextId}--${RELATION_TYPE.Contains}--${entity.id}`,
        source_entity_id: contextId,
        target_entity_id: entity.id,
        type: RELATION_TYPE.Contains,
      });
    }

    if (entity.type === ENTITY_TYPE.Contract) {
      const party = envelopeOf(data);
      const context = data?._context as string | undefined;
      const service = data?._service as string | undefined;
      if (party === undefined || !context || !service) continue;
      const serviceKey = `${entity.fileOrigin ?? ''}|${party}|${context}|${service}`;
      const serviceId = serviceIndex.get(serviceKey);
      if (!serviceId) continue;
      relations.push({
        id: `${serviceId}--${RELATION_TYPE.Provides}--${entity.id}`,
        source_entity_id: serviceId,
        target_entity_id: entity.id,
        type: RELATION_TYPE.Provides,
      });
    }
  }

  return relations;
}

/**
 * The services a service is built on (`imports`) and the services it depends on while running
 * (`uses`), as edges: Service -> Service, `service_imports` and `service_uses`.
 *
 * Each item is a `service_ref` and resolves by the shared resolution function against the id each
 * service DECLARES (`id: SVC###`), never against its name, which is what a service's `displayId`
 * holds. A reference resolves to the same string and nothing else, so `SVC001` does not reach a
 * service declared `shop.SVC001`. An item that resolves to no service, or to several, draws nothing:
 * the validator reports it, and a placeholder would show a dependency on something nobody declared.
 *
 * One edge per (relation, pair): a target named twice in one list is one edge. A target named in
 * both lists is two edges of two types, never merged - building on a library and calling a running
 * service are two statements. A service naming itself draws a self-loop, unlike the context
 * dependencies, which drop one: a self-import is a statement a cycle check must be able to see.
 */
export function extractServiceDependencyRelations(entities: Entity[]): Relation[] {
  const declarations: RefDeclaration[] = [];
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Service) continue;
    const declaredId = (entity.data as Record<string, unknown> | undefined)?.id;
    if (typeof declaredId === 'string' && declaredId.length > 0) {
      declarations.push({ id: declaredId, handle: entity.id });
    }
  }
  if (declarations.length === 0) return [];
  const index = indexDeclarations(declarations);

  const relations: Relation[] = [];
  const emitted = new Set<string>();
  const fields: ReadonlyArray<[string, string]> = [
    ['imports', RELATION_TYPE.ServiceImports],
    ['uses', RELATION_TYPE.ServiceUses],
  ];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Service) continue;
    const data = (entity.data as Record<string, unknown> | undefined) ?? {};
    for (const [field, type] of fields) {
      const items = data[field];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (typeof item !== 'string' || item.length === 0) continue;
        const resolution = resolveReference(index, item);
        if (resolution.status !== 'resolved') continue;
        const id = `${entity.id}--${type}--${resolution.handle}`;
        if (emitted.has(id)) continue;
        emitted.add(id);
        relations.push({
          id,
          source_entity_id: entity.id,
          target_entity_id: resolution.handle,
          type,
        });
      }
    }
  }

  return relations;
}
