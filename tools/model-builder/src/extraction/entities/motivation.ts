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

  return entities;
}
