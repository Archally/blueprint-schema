import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['decisions']!;

export function extractDecisions(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  const decisions = data.decisions as Record<string, unknown>[] | undefined;
  if (Array.isArray(decisions)) {
    for (const item of decisions) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const title = item.title != null ? String(item.title) : undefined;
      const summary = item.summary != null ? String(item.summary) : undefined;
      entities.push({
        id,
        displayId,
        type: ENTITY_TYPE.Decision,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: summary ?? title,
        term: title,
        description: undefined,
        data: item,
      });
    }
  }

  // BCC v5 — business_decisions[] (BD###). Distinct entity type from
  // ADR `decisions[]` above; same file (governance/decisions.schema.yaml)
  // because both are governance-axis artifacts. Added in v2.6.3.
  const businessDecisions = data.business_decisions as Record<string, unknown>[] | undefined;
  if (Array.isArray(businessDecisions)) {
    for (const item of businessDecisions) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const name = item.name != null ? String(item.name) : undefined;
      const description = item.description != null ? String(item.description) : undefined;
      entities.push({
        id,
        displayId,
        type: ENTITY_TYPE.BusinessDecision,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: name,
        term: name,
        description,
        data: item,
      });
    }
  }

  return entities;
}
