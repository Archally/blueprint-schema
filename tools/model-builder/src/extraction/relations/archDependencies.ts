import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder } from './resolver.js';

/**
 * Context → Context dependency relations from arch `dependencies[]`.
 *
 * Each context declares `dependencies: [{ name, type, relationship, direction, ... }]` naming another
 * bounded context or an external system. The name is resolved to a Context entity by displayId
 * (context names are unique across the arch); an unresolved name becomes a Missing placeholder
 * (e.g. an external system not modeled as a context). The DDD annotations (relationship / direction /
 * integration type) are carried on the relation `data` so renderers and dependency audits can read the
 * strategic intent. Without this, `dependencies[]` lived only inside Context.data and depended-upon
 * contexts showed up as false "orphan-entities".
 */
export function extractArchDependencyRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  const contextByName = new Map<string, string>();
  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.Context) contextByName.set(entity.displayId, entity.id);
  }

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Context) continue;
    const deps = entity.data?.dependencies as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(deps)) continue;
    for (const dep of deps) {
      const name = dep?.name;
      if (typeof name !== 'string' || !name) continue;
      let targetId = contextByName.get(name);
      if (!targetId) {
        const placeholder = createPlaceholder(name);
        if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
        targetId = placeholder.id;
      }
      if (targetId === entity.id) continue; // ignore self-dependency
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.DependsOn}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.DependsOn,
        data: {
          ...(dep.relationship != null ? { relationship: dep.relationship } : {}),
          ...(dep.direction != null ? { direction: dep.direction } : {}),
          ...(dep.type != null ? { integration_type: dep.type } : {}),
          ...(dep.language_boundary != null ? { language_boundary: dep.language_boundary } : {}),
        },
      });
    }
  }

  return relations;
}
