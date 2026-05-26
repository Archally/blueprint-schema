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

/** Get a nested property by dot-path (e.g. "payload.model"). */
export function getNestedProperty(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested property by dot-path. Creates intermediate objects as needed. */
export function setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] == null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

/** Delete a nested property by dot-path. */
export function deleteNestedProperty(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] == null || typeof current[part] !== 'object') return;
    current = current[part] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]!];
}
