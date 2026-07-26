import type { Entity, ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['leverage']!;

/**
 * Extract LeveragePoint entities (LP###) from a governance/leverage.yaml document.
 * Leverage points are a flat array (their `depends_on`/`enables` are refs, not nested children),
 * so no recursion is needed. The raw item is preserved on `data` for data-field semantic checks
 * and for relation extraction (see extraction/relations/leverage.ts).
 */
export function extractLeverage(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const points = data.leverage_points as Record<string, unknown>[] | undefined;
  if (!Array.isArray(points)) return entities;

  for (const item of points) {
    if (!item || typeof item !== 'object' || item.id == null) continue;
    const displayId = String(item.id);
    const id = makeInternalId(doc.scope, doc.filePath, displayId);
    const title = item.title != null ? String(item.title) : undefined;
    const summary = item.summary != null ? String(item.summary) : title;
    const description = item.one_thing != null ? String(item.one_thing) : undefined;
    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.LeveragePoint,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary,
      term: title,
      description,
      data: item,
    });
  }
  return entities;
}
