import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['ui']!;

/**
 * Extract UI entities from one ui document.
 *
 * Schema shape (flat arrays):
 *   screens: [{ id, name, ... }]
 *   actions: [{ id, screen, name, ... }]
 *   navigation: [{ id, from, to, ... }]
 */
export function extractUI(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  const screens = data.screens as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(screens)) {
    for (const item of screens) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const name = item.name != null ? String(item.name) : undefined;
      const summary = item.summary != null ? String(item.summary) : undefined;
      entities.push({
        id,
        displayId,
        type: ENTITY_TYPE.Screen,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: summary ?? name,
        term: name,
        description: item.description != null ? String(item.description) : undefined,
        data: item,
      });
    }
  }

  const actions = data.actions as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(actions)) {
    for (const item of actions) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const name = item.name != null ? String(item.name) : undefined;
      entities.push({
        id,
        displayId,
        type: ENTITY_TYPE.UIAction,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: name,
        term: name,
        description: item.description != null ? String(item.description) : undefined,
        data: item,
      });
    }
  }

  const navigation = data.navigation as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(navigation)) {
    for (const item of navigation) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const description = item.description != null ? String(item.description) : undefined;
      entities.push({
        id,
        displayId,
        type: ENTITY_TYPE.UINavigation,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: description,
        description,
        data: item,
      });
    }
  }

  return entities;
}
