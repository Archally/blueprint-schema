import type { Entity, ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['leverage']!;

/**
 * Extract LeveragePoint entities (LP###) and WatchItem entities (WCH###) from a
 * governance/leverage.yaml document. Leverage points and watch items are flat arrays (their ref
 * lists are refs, not nested children), so no recursion is needed. The raw item is preserved on
 * `data` for data-field semantic checks and for relation extraction (see
 * extraction/relations/leverage.ts).
 */
export function extractLeverage(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const points = data.leverage_points as Record<string, unknown>[] | undefined;
  if (Array.isArray(points)) entities.push(...extractPoints(doc, points));
  const watchlist = data.watchlist as Record<string, unknown>[] | undefined;
  if (Array.isArray(watchlist)) entities.push(...extractWatchItems(doc, watchlist));
  return entities;
}

function extractPoints(doc: ParsedBlueprintDocument, points: Record<string, unknown>[]): Entity[] {
  const entities: Entity[] = [];

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

/** A watch item is named by its `title`; its `note` says why it is watched. */
function extractWatchItems(doc: ParsedBlueprintDocument, items: Record<string, unknown>[]): Entity[] {
  const entities: Entity[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.id == null) continue;
    const displayId = String(item.id);
    const title = item.title != null ? String(item.title) : undefined;
    entities.push({
      id: makeInternalId(doc.scope, doc.filePath, displayId),
      displayId,
      type: ENTITY_TYPE.WatchItem,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: title,
      term: title,
      description: item.note != null ? String(item.note) : undefined,
      data: item,
    });
  }
  return entities;
}
