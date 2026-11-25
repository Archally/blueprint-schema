/**
 * Apply property-level migration changes: set, unset, rename, append, remove-item.
 */
import type { BlueprintModel, Entity } from '../../model/types.js';
import { MigrationError } from '../migrationError.js';
import { findEntityByRef } from '../migrationApplyUtils.js';
import { applyPropertyChange } from '../replayKernel.js';

function syncEntityTopLevelFields(entity: Entity, property: string, value: unknown): void {
  if (property === 'description' || property === 'definition') {
    entity.description = value != null ? String(value) : undefined;
  } else if (property === 'term' || property === 'name') {
    entity.term = value != null ? String(value) : undefined;
  } else if (property === 'summary') {
    entity.summary = value != null ? String(value) : undefined;
  }
}

export function applyPropertyChanges(model: BlueprintModel, changes: Record<string, unknown>[]): void {
  for (const change of changes) {
    const kind = String(change.kind ?? '');
    const target = String(change.target ?? '');
    const entity = findEntityByRef(target, model.entities);
    if (!entity) {
      throw new MigrationError(`Property ${kind}: target not found: ${target}`);
    }
    if (!entity.data) {
      entity.data = {};
    }
    applyPropertyChange(entity.data, change, (property, value) => syncEntityTopLevelFields(entity, property, value));
  }
}
