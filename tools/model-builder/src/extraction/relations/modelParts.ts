import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

/**
 * The parts of entities that carry their own typed id: a process activity (PA###, in a Process's
 * `activities`) and a concept attribute (CAT###, a value of a Concept's `attributes` map). A part
 * is not a graph entity; a pin on it is an edge to its container that carries the part's identity.
 *
 * An activity id is unique within its process, not within the model, so two processes may declare
 * one id; every declaration is listed, and a reader that resolves an id sees both.
 */
export type ModelPartKind = 'process_activity' | 'concept_attribute';

export interface ModelPart {
  /** The id as declared, scope prefix included. */
  id: string;
  kind: ModelPartKind;
  /** The entity that declares the part. */
  container: Entity;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Every declared part, in entity order and, within an entity, in declaration order. */
export function modelParts(entities: Entity[]): ModelPart[] {
  const parts: ModelPart[] = [];
  for (const entity of entities) {
    const data = record(entity.data);
    if (data === undefined) continue;
    if (entity.type === ENTITY_TYPE.Process && Array.isArray(data.activities)) {
      for (const activity of data.activities) {
        const id = record(activity)?.id;
        if (typeof id === 'string' && id !== '') parts.push({ id, kind: 'process_activity', container: entity });
      }
    }
    if (entity.type === ENTITY_TYPE.Concept) {
      const attributes = record(data.attributes);
      for (const attribute of Object.values(attributes ?? {})) {
        const id = record(attribute)?.id;
        if (typeof id === 'string' && id !== '') parts.push({ id, kind: 'concept_attribute', container: entity });
      }
    }
  }
  return parts;
}
