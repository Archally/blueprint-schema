import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['motivation']!;

const MOTIVATION_COLLECTIONS: { key: string; type: string }[] = [
  { key: 'goals', type: ENTITY_TYPE.Goal },
  { key: 'non_goals', type: ENTITY_TYPE.NonGoal },
  { key: 'risks', type: ENTITY_TYPE.Risk },
  { key: 'assumptions', type: ENTITY_TYPE.Assumption },
  { key: 'trade_offs', type: ENTITY_TYPE.TradeOff },
  { key: 'inquiries', type: ENTITY_TYPE.Inquiry },
];

function toMotivationEntity(
  doc: ParsedBlueprintDocument,
  type: string,
  item: Record<string, unknown>
): Entity {
  const displayId = String(item.id ?? '');
  const id = makeInternalId(doc.scope, doc.filePath, displayId);
  const statement = item.statement != null ? String(item.statement) : undefined;
  const summary = item.summary != null ? String(item.summary) : statement;
  const name = item.name != null ? String(item.name) : undefined;
  return {
    id,
    displayId,
    type,
    layer: LAYER,
    fileOrigin: doc.filePath,
    summary: summary ?? name,
    term: name,
    description: statement,
    data: item,
  };
}

/**
 * The singular `vision` object has no `id` in the schema (at most one per model), so it
 * gets a stable synthetic displayId. Extract ONLY when `motivation.vision` is present —
 * most models have none (v2.7.7 vision CR, D045).
 */
const VISION_DISPLAY_ID = 'vision';

function toVisionEntity(doc: ParsedBlueprintDocument, vision: Record<string, unknown>): Entity {
  const id = makeInternalId(doc.scope, doc.filePath, VISION_DISPLAY_ID);
  const statement = vision.statement != null ? String(vision.statement) : undefined;
  const aspiration = vision.aspiration != null ? String(vision.aspiration) : undefined;
  return {
    id,
    displayId: VISION_DISPLAY_ID,
    type: ENTITY_TYPE.Vision,
    layer: LAYER,
    fileOrigin: doc.filePath,
    summary: statement ?? aspiration,
    term: 'Vision',
    description: statement ?? aspiration,
    data: vision,
  };
}

export function extractMotivation(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  for (const { key, type } of MOTIVATION_COLLECTIONS) {
    const arr = data[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && typeof item === 'object' && item.id != null) {
        entities.push(toMotivationEntity(doc, type, item as Record<string, unknown>));
      }
    }
  }

  const vision = data.vision;
  if (vision && typeof vision === 'object' && !Array.isArray(vision)) {
    entities.push(toVisionEntity(doc, vision as Record<string, unknown>));
  }

  return entities;
}
