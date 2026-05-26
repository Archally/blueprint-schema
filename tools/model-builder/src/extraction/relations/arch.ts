import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Extract structural containment relations from arch entities.
 * These are not ref-based — they derive from the YAML nesting hierarchy
 * preserved via _party, _context, _service fields in entity.data.
 *
 * - Context → Service (contains)
 * - Service → Contract (provides)
 */
export function extractArchRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  // Build lookup indexes keyed by structural coordinates so we can find
  // parent entities for each service and contract in O(1).
  const contextIndex = new Map<string, string>(); // "{fileOrigin}|{party}|{context}" → entity id
  const serviceIndex = new Map<string, string>(); // "{fileOrigin}|{party}|{context}|{service}" → entity id

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;
    if (entity.type === ENTITY_TYPE.Context) {
      const party = data?._party as string | undefined;
      if (party) {
        const key = `${entity.fileOrigin ?? ''}|${party}|${entity.displayId}`;
        contextIndex.set(key, entity.id);
      }
    }
    if (entity.type === ENTITY_TYPE.Service) {
      const party = data?._party as string | undefined;
      const context = data?._context as string | undefined;
      if (party && context) {
        const key = `${entity.fileOrigin ?? ''}|${party}|${context}|${entity.displayId}`;
        serviceIndex.set(key, entity.id);
      }
    }
  }

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;

    if (entity.type === ENTITY_TYPE.Service) {
      const party = data?._party as string | undefined;
      const context = data?._context as string | undefined;
      if (!party || !context) continue;
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
      const party = data?._party as string | undefined;
      const context = data?._context as string | undefined;
      const service = data?._service as string | undefined;
      if (!party || !context || !service) continue;
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
