import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['quality']!;

const QUALITY_COLLECTIONS: { key: string; type: string }[] = [
  { key: 'metrics', type: ENTITY_TYPE.Metric },
  { key: 'kpis', type: ENTITY_TYPE.KPI },
  { key: 'slos', type: ENTITY_TYPE.SLO },
  { key: 'slas', type: ENTITY_TYPE.SLA },
  { key: 'security', type: ENTITY_TYPE.Security },
  { key: 'compliance', type: ENTITY_TYPE.Compliance },
  { key: 'resilience', type: ENTITY_TYPE.Resilience },
];

export function extractQuality(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  for (const { key, type } of QUALITY_COLLECTIONS) {
    const arr = data[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const name = item.name != null ? String(item.name) : undefined;
      const summary = item.summary != null ? String(item.summary) : undefined;
      const description = item.description != null
        ? String(item.description)
        : item.requirement != null
          ? String(item.requirement)
          : item.target != null
            ? String(item.target)
            : undefined;
      entities.push({
        id,
        displayId,
        type,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: summary ?? name,
        term: name,
        description,
        data: item,
      });
    }
  }

  return entities;
}
