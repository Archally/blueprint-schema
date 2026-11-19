import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder } from './resolver.js';

import { indexDeclarations, resolveReference } from './refResolution.js';
import { declarationOrigin, declarationRelationId, localEvidence } from './linkEvidence.js';

/** Typed references are authoritative; name fallback is for declarations without a typed ref. */
export function extractArchDependencyRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>,
): Relation[] {
  const relations: Relation[] = [];

  const contexts = entities.filter(entity => entity.type === ENTITY_TYPE.Context);
  const typed = indexDeclarations(contexts.flatMap(entity =>
    typeof entity.data?.id === 'string' ? [{ id: entity.data.id, handle: entity.id }] : []));
  const named = indexDeclarations(contexts.map(entity => ({ id: entity.displayId, handle: entity.id })));

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Context) continue;
    const dependencies = entity.data?.dependencies as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(dependencies)) continue;
    const occurrences = new Map<string, number>();
    for (const dependency of dependencies) {
      const name = dependency?.name;
      if (typeof name !== 'string' || !name) continue;
      const reference = typeof dependency.bounded_context_ref === 'string' ? dependency.bounded_context_ref : name;
      const resolution = resolveReference(typeof dependency.bounded_context_ref === 'string' ? typed : named, reference);
      let targetId: string;
      if (resolution.status === 'resolved') {
        targetId = resolution.handle;
      } else {
        const placeholder = createPlaceholder(reference, resolution.status === 'ambiguous' ? resolution.handles : undefined);
        if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
        targetId = placeholder.id;
      }
      const key = JSON.stringify([name, reference]);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const selector = `dependencies[key=${encodeURIComponent(key)}][occurrence=${occurrence}]`;
      if (targetId === entity.id) continue; // ignore self-dependency
      relations.push({
        id: declarationRelationId(entity, selector, RELATION_TYPE.ContextDependsOn),
        origin_ref: declarationOrigin(entity, selector),
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.ContextDependsOn,
        data: {
          ...localEvidence(dependency),
          ...(dependency.relationship != null ? { relationship: dependency.relationship } : {}),
          ...(dependency.direction != null ? { direction: dependency.direction } : {}),
          ...(dependency.coupling != null ? { coupling: dependency.coupling } : {}),
          ...(dependency.type != null ? { integration_type: dependency.type } : {}),
          ...(dependency.language_boundary != null ? { language_boundary: dependency.language_boundary } : {}),
        },
      });
    }
  }

  return relations;
}
