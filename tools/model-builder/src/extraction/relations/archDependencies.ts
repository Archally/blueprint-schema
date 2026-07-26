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
 *
 * Ported from the public `tools/model-builder/src/extraction/relations/archDependencies.ts`; keep the
 * two in lockstep (both stacks run one shared semantic-rule pack).
 *
 * NOTE: this resolves by **context name**, which is the v2.7.x shape. v2.7.6 D10 prefers a typed
 * `bounded_context_ref: BC###` on the dependency; when that becomes the only form, resolve the typed
 * id first and fall back to the name — change it in both builders at once.
 */
export function extractArchDependencyRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>,
): Relation[] {
  const relations: Relation[] = [];

  const contextByName = new Map<string, string>();
  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.Context) contextByName.set(entity.displayId, entity.id);
  }

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Context) continue;
    const dependencies = entity.data?.dependencies as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(dependencies)) continue;
    for (const dependency of dependencies) {
      const name = dependency?.name;
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
          ...(dependency.relationship != null ? { relationship: dependency.relationship } : {}),
          ...(dependency.direction != null ? { direction: dependency.direction } : {}),
          ...(dependency.type != null ? { integration_type: dependency.type } : {}),
          ...(dependency.language_boundary != null ? { language_boundary: dependency.language_boundary } : {}),
        },
      });
    }
  }

  return relations;
}
