import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['concepts']!;

/**
 * Synthetic context-link payload merged into each emitted entity's `data`.
 * Phase 2 step-03 needs Concepts / Actors / Enumerations / Associations to
 * know which BoundedContext owns them; the link comes from the file-level
 * `name:` field (the context name) and the document's `scope`.
 *
 * Underscore-prefixed keys mirror arch.ts's `_party` / `_context` /
 * `_service` convention.
 */
function makeContextLink(doc: ParsedBlueprintDocument): {
  _context_name?: string;
  _scope?: string;
} {
  const data = doc.data ?? {};
  const link: { _context_name?: string; _scope?: string } = {};
  const contextName = (data as Record<string, unknown>).name;
  if (typeof contextName === 'string' && contextName.length > 0) {
    link._context_name = contextName;
  }
  if (typeof doc.scope === 'string' && doc.scope.length > 0) {
    link._scope = doc.scope;
  }
  return link;
}

function toEntity(
  doc: ParsedBlueprintDocument,
  type: string,
  item: Record<string, unknown>,
  idKey: string,
  contextLink: ReturnType<typeof makeContextLink>,
): Entity {
  const displayId = String(item[idKey] ?? '');
  const id = makeInternalId(doc.scope, doc.filePath, displayId);
  const summary = item.summary != null ? String(item.summary) : undefined;
  const term = item.name != null ? String(item.name) : item.term != null ? String(item.term) : undefined;
  const description = item.description != null ? String(item.description) : item.definition != null ? String(item.definition) : undefined;
  return {
    id,
    displayId,
    type,
    layer: LAYER,
    fileOrigin: doc.filePath,
    summary,
    term,
    description,
    data: { ...item, ...contextLink },
  };
}

export function extractConcepts(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const contextLink = makeContextLink(doc);

  const concepts = data.concepts as Record<string, unknown>[] | undefined;
  if (Array.isArray(concepts)) {
    for (const item of concepts) {
      if (item && typeof item === 'object' && item.id != null) {
        entities.push(toEntity(doc, ENTITY_TYPE.Concept, item as Record<string, unknown>, 'id', contextLink));
      }
    }
  }

  const actors = data.actors as Record<string, unknown>[] | undefined;
  if (Array.isArray(actors)) {
    for (const item of actors) {
      if (item && typeof item === 'object' && item.id != null) {
        entities.push(toEntity(doc, ENTITY_TYPE.Actor, item as Record<string, unknown>, 'id', contextLink));
      }
    }
  }

  const enumerations = data.enumerations as Record<string, unknown>[] | undefined;
  if (Array.isArray(enumerations)) {
    for (const item of enumerations) {
      if (item && typeof item === 'object' && item.id != null) {
        entities.push(toEntity(doc, ENTITY_TYPE.Enumeration, item as Record<string, unknown>, 'id', contextLink));
      }
    }
  }

  const associations = data.associations as Record<string, unknown>[] | undefined;
  if (Array.isArray(associations)) {
    for (const item of associations) {
      if (item && typeof item === 'object' && item.id != null) {
        entities.push(toEntity(doc, ENTITY_TYPE.Association, item as Record<string, unknown>, 'id', contextLink));
      }
    }
  }

  return entities;
}
