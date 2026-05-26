import type { Entity } from '../../model/types.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['roadmap']!;

/**
 * Extract Milestone entities from a parsed roadmap document.
 * Each milestones[] item becomes one Milestone entity.
 */
export function extractRoadmap(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const docScope = (doc.scope ?? data.scope) as string | undefined;
  const milestones = data.milestones as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(milestones)) return entities;

  for (const item of milestones) {
    if (!item || typeof item !== 'object' || item.id == null) continue;
    const displayId = String(item.id);
    const id = makeInternalId(docScope, doc.filePath, displayId);
    const name = item.name != null ? String(item.name) : undefined;
    const description = item.description != null ? String(item.description) : undefined;

    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.Milestone,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: name,
      term: name,
      description,
      data: item,
    });
  }

  return entities;
}
