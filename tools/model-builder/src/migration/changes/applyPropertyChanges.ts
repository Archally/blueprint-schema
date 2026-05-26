/**
 * Apply property-level migration changes: set, unset, rename, append, remove-item.
 */
import type { BlueprintModel, Entity } from '../../model/types.js';
import { MigrationError } from '../migrationError.js';
import {
  findEntityByRef,
  getNestedProperty,
  setNestedProperty,
  deleteNestedProperty,
} from '../migrationApplyUtils.js';

function syncEntityTopLevelFields(entity: Entity, property: string, value: unknown): void {
  if (property === 'description' || property === 'definition') {
    entity.description = value != null ? String(value) : undefined;
  } else if (property === 'term' || property === 'name') {
    entity.term = value != null ? String(value) : undefined;
  } else if (property === 'summary') {
    entity.summary = value != null ? String(value) : undefined;
  }
}

// ---------------------------------------------------------------------------
// Apply: Property changes
// ---------------------------------------------------------------------------

export function applyPropertyChanges(
  model: BlueprintModel,
  changes: Record<string, unknown>[],
): void {
  for (const change of changes) {
    const kind = String(change.kind ?? '');
    const target = String(change.target ?? '');
    const property = String(change.property ?? '');

    const entity = findEntityByRef(target, model.entities);
    if (!entity) throw new MigrationError(`Property ${kind}: target not found: ${target}`);
    if (!entity.data) entity.data = {};

    switch (kind) {
      case 'set': {
        setNestedProperty(entity.data, property, change.value);
        syncEntityTopLevelFields(entity, property, change.value);
        break;
      }
      case 'unset': {
        deleteNestedProperty(entity.data, property);
        break;
      }
      case 'rename': {
        const newName = String(change.new_name ?? '');
        if (!newName) throw new MigrationError(`Property rename: missing new_name for ${target}.${property}`);
        const value = getNestedProperty(entity.data, property);
        deleteNestedProperty(entity.data, property);
        setNestedProperty(entity.data, newName, value);
        break;
      }
      case 'append': {
        const arr = getNestedProperty(entity.data, property);
        if (Array.isArray(arr)) {
          arr.push(change.value);
        } else {
          setNestedProperty(entity.data, property, [change.value]);
        }
        break;
      }
      case 'remove-item': {
        const arr = getNestedProperty(entity.data, property);
        if (Array.isArray(arr)) {
          const val = change.value;
          const idx = arr.findIndex((item) =>
            typeof item === 'object' && item !== null
              ? JSON.stringify(item) === JSON.stringify(val)
              : item === val,
          );
          if (idx >= 0) arr.splice(idx, 1);
        }
        break;
      }
      default:
        throw new MigrationError(`Unknown property change kind: ${kind}`);
    }
  }
}
