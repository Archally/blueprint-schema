import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['capability']!;
const MAX_DEPTH = 10;

function extractCapabilityTree(
  doc: ParsedBlueprintDocument,
  items: Record<string, unknown>[],
  entities: Entity[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.id == null) continue;
    const displayId = String(item.id);
    const id = makeInternalId(doc.scope, doc.filePath, displayId);
    const name = item.name != null ? String(item.name) : undefined;
    const description = item.description != null ? String(item.description) : undefined;
    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.Capability,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: name,
      term: name,
      description,
      data: item,
    });
    const children = item.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) {
      extractCapabilityTree(doc, children, entities, depth + 1);
    }
  }
}

export function extractCapability(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const capabilities = data.capabilities as Record<string, unknown>[] | undefined;
  if (Array.isArray(capabilities)) {
    extractCapabilityTree(doc, capabilities, entities, 0);
  }
  return entities;
}
