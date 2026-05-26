/**
 * Pre-built lookup indexes derived from BlueprintModel.
 * All in-memory; rebuild on every model change. Mirrors the brandvoice-core
 * pattern (`servers/brandvoice/core/src/types.ts` ModelIndexes + buildIndexes).
 */

import type { BlueprintModel, Entity, Relation } from './types.js';

export interface ModelIndexes {
  /** O(1) entity lookup by ID. */
  byId: Map<string, Entity>;
  /** Entities grouped by type (e.g. 'BoundedContext', 'Aggregate', 'Event'). */
  byType: Map<string, Entity[]>;
  /** Entities grouped by layer (e.g. 'design', 'governance'). */
  byLayer: Map<string, Entity[]>;
  /** Entities grouped by source file (requires fileOrigin field). */
  byFile: Map<string, Entity[]>;
}

export interface GraphIndex {
  /** entityId → relations originating at the entity. */
  outgoing: Map<string, Relation[]>;
  /** entityId → relations terminating at the entity. */
  incoming: Map<string, Relation[]>;
}

/** Build all model indexes in a single pass over entities + relations. */
export function buildModelIndexes(model: BlueprintModel): ModelIndexes {
  const byId = new Map<string, Entity>();
  const byType = new Map<string, Entity[]>();
  const byLayer = new Map<string, Entity[]>();
  const byFile = new Map<string, Entity[]>();

  for (const entity of model.entities) {
    byId.set(entity.id, entity);

    const typeBucket = byType.get(entity.type);
    if (typeBucket) typeBucket.push(entity);
    else byType.set(entity.type, [entity]);

    const layerBucket = byLayer.get(entity.layer);
    if (layerBucket) layerBucket.push(entity);
    else byLayer.set(entity.layer, [entity]);

    if (entity.fileOrigin) {
      const fileBucket = byFile.get(entity.fileOrigin);
      if (fileBucket) fileBucket.push(entity);
      else byFile.set(entity.fileOrigin, [entity]);
    }
  }

  return { byId, byType, byLayer, byFile };
}

/** Build a bidirectional adjacency index from the model's relations. */
export function buildGraphIndex(relations: Relation[]): GraphIndex {
  const outgoing = new Map<string, Relation[]>();
  const incoming = new Map<string, Relation[]>();

  for (const relation of relations) {
    const out = outgoing.get(relation.source_entity_id);
    if (out) out.push(relation);
    else outgoing.set(relation.source_entity_id, [relation]);

    const inc = incoming.get(relation.target_entity_id);
    if (inc) inc.push(relation);
    else incoming.set(relation.target_entity_id, [relation]);
  }

  return { outgoing, incoming };
}
