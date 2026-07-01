import type { Entity } from '../../model/types.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['roadmap']!;
const MAX_DEPTH = 10;

/**
 * Extract Milestone and WorkItem entities from a parsed roadmap document.
 * - Each milestones[] item becomes one Milestone entity (dated release target).
 * - Each work_items[] item (and its nested children[], recursively) becomes one
 *   WorkItem entity (execution-tier WBS: epic/phase/foundation/subscope/task, v2.7.2).
 */
export function extractRoadmap(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const docScope = (doc.scope ?? data.scope) as string | undefined;

  const milestones = data.milestones as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(milestones)) {
    for (const item of milestones) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      entities.push({
        id: makeInternalId(docScope, doc.filePath, displayId),
        displayId,
        type: ENTITY_TYPE.Milestone,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: item.name != null ? String(item.name) : undefined,
        term: item.name != null ? String(item.name) : undefined,
        description: item.description != null ? String(item.description) : undefined,
        data: item,
      });
    }
  }

  const workItems = data.work_items as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(workItems)) {
    extractWorkItemTree(doc, docScope, workItems, entities, 0);
  }

  return entities;
}

/** Recursively flatten a work_items[] tree into WorkItem entities (children nested via `children[]`). */
function extractWorkItemTree(
  doc: ParsedBlueprintDocument,
  docScope: string | undefined,
  items: Array<Record<string, unknown>>,
  entities: Entity[],
  depth: number
): void {
  if (depth > MAX_DEPTH) return;
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.id == null) continue;
    const displayId = String(item.id);
    entities.push({
      id: makeInternalId(docScope, doc.filePath, displayId),
      displayId,
      type: ENTITY_TYPE.WorkItem,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: item.name != null ? String(item.name) : undefined,
      term: item.name != null ? String(item.name) : undefined,
      description: item.description != null ? String(item.description) : undefined,
      data: item,
    });
    const children = item.children as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(children)) {
      extractWorkItemTree(doc, docScope, children, entities, depth + 1);
    }
  }
}
