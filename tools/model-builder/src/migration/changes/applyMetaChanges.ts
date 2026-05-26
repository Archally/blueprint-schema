/**
 * Apply meta-level migration changes: tag-add, tag-remove, tag-rename, bulk-tag, etc.
 */
import type { BlueprintModel, Entity } from '../../model/types.js';
import { MigrationError } from '../migrationError.js';
import { findEntityByRef } from '../migrationApplyUtils.js';
import { MIGRATION_ENTITY_TYPE_MAP } from './applyEntityChanges.js';

/**
 * Filter entities by meta_change filter criteria.
 */
function filterEntities(
  entities: Entity[],
  filter: Record<string, unknown> | undefined,
): Entity[] {
  if (!filter) return entities;

  return entities.filter((entity) => {
    if (filter.entity_type) {
      const mapping = MIGRATION_ENTITY_TYPE_MAP[String(filter.entity_type)];
      if (mapping && entity.type !== mapping.type) return false;
    }
    if (filter.slice && typeof filter.slice === 'string') {
      const origin = entity.fileOrigin ?? '';
      if (!origin.replace(/\\/g, '/').startsWith(filter.slice + '/') &&
          !origin.replace(/\\/g, '/').startsWith(filter.slice + '\\')) {
        return false;
      }
    }
    if (filter.layer && typeof filter.layer === 'string' && entity.layer !== filter.layer) {
      return false;
    }
    if (filter.tags && Array.isArray(filter.tags)) {
      const entityTags = entity.data && Array.isArray(entity.data.tags) ? entity.data.tags as string[] : [];
      const filterTags = filter.tags as string[];
      if (!filterTags.some((t) => entityTags.includes(t))) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Apply: Meta changes
// ---------------------------------------------------------------------------

export function applyMetaChanges(
  model: BlueprintModel,
  changes: Record<string, unknown>[],
): void {
  for (const change of changes) {
    const kind = String(change.kind ?? '');
    const target = String(change.target ?? '');

    switch (kind) {
      case 'tag-add': {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) throw new MigrationError(`Meta tag-add: target not found: ${target}`);
        if (!entity.data) entity.data = {};
        const tags = Array.isArray(entity.data.tags) ? entity.data.tags as string[] : [];
        const tag = String(change.value ?? '');
        if (tag && !tags.includes(tag)) tags.push(tag);
        entity.data.tags = tags;
        break;
      }
      case 'tag-remove': {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) throw new MigrationError(`Meta tag-remove: target not found: ${target}`);
        if (entity.data && Array.isArray(entity.data.tags)) {
          const tag = String(change.value ?? '');
          entity.data.tags = (entity.data.tags as string[]).filter((t) => t !== tag);
        }
        break;
      }
      case 'tag-rename': {
        const oldTag = target;
        const newTag = String(change.value ?? '');
        if (!newTag) break;
        for (const entity of model.entities) {
          if (entity.data && Array.isArray(entity.data.tags)) {
            const tags = entity.data.tags as string[];
            const idx = tags.indexOf(oldTag);
            if (idx >= 0) tags[idx] = newTag;
          }
        }
        break;
      }
      case 'bulk-tag': {
        const tag = String(change.value ?? '');
        if (!tag) break;
        const filter = change.filter as Record<string, unknown> | undefined;
        const matching = filterEntities(model.entities, filter);
        for (const entity of matching) {
          if (!entity.data) entity.data = {};
          const tags = Array.isArray(entity.data.tags) ? entity.data.tags as string[] : [];
          if (!tags.includes(tag)) tags.push(tag);
          entity.data.tags = tags;
        }
        break;
      }
      case 'reclassify':
      case 'move-to-slice':
      case 'constitution-amend':
      case 'declare-shared-layer':
      case 'document-add':
      case 'document-move':
      case 'document-split':
      case 'document-merge':
        // These are structural/governance changes that don't affect the in-memory model graph.
        break;
      case 'note':
        // Informational only — no model change.
        break;
      default:
        throw new MigrationError(`Unknown meta change kind: ${kind}`);
    }
  }
}
