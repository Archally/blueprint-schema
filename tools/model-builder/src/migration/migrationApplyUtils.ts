/**
 * Shared utilities for migration application: ref resolution and nested property access.
 */
import type { Entity } from '../model/types.js';
import { resolveRef } from '../extraction/relations/resolver.js';
import { MigrationError } from './migrationError.js';

/**
 * Resolve a typed ref (CN001, CMD002) to an existing entity.
 */
export function findEntityByRef(ref: string, entities: Entity[]): Entity | null {
  const id = resolveRef(ref, 'default', entities);
  if (!id) return null;
  return entities.find((e) => e.id === id) ?? null;
}

/**
 * Resolve a typed ref to an internal entity id. Throws MigrationError if not found.
 */
export function resolveTargetId(
  ref: string,
  entities: Entity[],
  context: string,
): string {
  const id = resolveRef(ref, 'default', entities);
  if (!id) {
    throw new MigrationError(`Target not found: ${ref} (${context})`);
  }
  return id;
}

/** Pure property utilities shared with other model adapters. */
export { getNestedProperty, setNestedProperty, deleteNestedProperty } from './replayKernel.js';
