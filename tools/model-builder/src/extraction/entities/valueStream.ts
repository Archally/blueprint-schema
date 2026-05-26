import type { Entity } from '../../model/types.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['value-stream']!;

/**
 * Extract ValueStream entities from a value-stream document.
 * Each value_stream item becomes a ValueStream entity with stages preserved in data.
 */
export function extractValueStream(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const valueStreams = data.value_streams as Record<string, unknown>[] | undefined;
  if (!Array.isArray(valueStreams)) return entities;

  for (const item of valueStreams) {
    if (!item || typeof item !== 'object' || item.id == null) continue;

    const displayId = String(item.id);
    const id = makeInternalId(doc.scope, doc.filePath, displayId);
    const name = item.name != null ? String(item.name) : undefined;
    const description = item.description != null ? String(item.description) : undefined;

    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.ValueStream,
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
