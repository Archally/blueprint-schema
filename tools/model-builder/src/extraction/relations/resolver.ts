import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { indexDeclarations, resolveReference, type RefDeclaration, type RefIndex, type RefResolution } from './refResolution.js';

/**
 * Extract domain from an entity's fileOrigin path (first path segment).
 * Mirrors the logic in entities/id.ts for consistency.
 */
export function entityDomain(entity: Entity): string {
  const fileOrigin = entity.fileOrigin ?? '';
  const segments = fileOrigin.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 1 ? segments[0]! : 'default';
}

/**
 * The index of every entity by the id string it was declared with (`displayId`), built once per
 * entity list and rebuilt when the list grows. Placeholders never take part.
 */
const indexes = new WeakMap<Entity[], { size: number; index: RefIndex }>();

function entityIndex(allEntities: Entity[]): RefIndex {
  const cached = indexes.get(allEntities);
  if (cached && cached.size === allEntities.length) return cached.index;
  const declarations: RefDeclaration[] = [];
  for (const entity of allEntities) {
    if (entity.type === ENTITY_TYPE.Missing || typeof entity.displayId !== 'string') continue;
    declarations.push({ id: entity.displayId, handle: entity.id });
  }
  const index = indexDeclarations(declarations);
  indexes.set(allEntities, { size: allEntities.length, index });
  return index;
}

/**
 * How a typed ref resolves against a list of entities, by the shared resolution function: to the
 * entity whose declared id is the same string (`resolved`), to every such entity when several
 * declare it (`ambiguous`), or to none (`unresolved`). A scope prefix is part of the id, so
 * `billing.CN001` never resolves to a `CN001`, nor `CN001` to a `billing.CN001`.
 */
export function resolveRefDetailed(ref: string, allEntities: Entity[]): RefResolution {
  return resolveReference(entityIndex(allEntities), ref);
}

/**
 * Resolve a typed ref string to an existing entity's internal id, or null - for `unresolved` and
 * for `ambiguous` alike, so an ambiguous ref is never drawn to one of its candidates.
 *
 * `sourceDomain` is accepted so every call site keeps its shape, and is not read: the folder a
 * reference is written in is not part of the reference.
 */
export function resolveRef(
  ref: string,
  _sourceDomain: string,
  allEntities: Entity[]
): string | null {
  const resolution = resolveRefDetailed(ref, allEntities);
  return resolution.status === 'resolved' ? resolution.handle : null;
}

/**
 * Create a placeholder "Missing" entity for a ref that resolves to no single entity.
 * The id is deterministic: missing-{sanitized-ref}.
 * Multiple sources referencing the same unresolvable ref share one placeholder. `candidates`, when
 * there are several, marks the placeholder ambiguous and names the entities that declare the ref.
 */
export function createPlaceholder(ref: string, candidates?: string[]): Entity {
  const sanitized = ref.replace(/[^a-zA-Z0-9]/g, '-');
  return {
    id: `missing-${sanitized}`,
    displayId: ref,
    type: ENTITY_TYPE.Missing,
    layer: 'unknown',
    fileOrigin: '',
    data: candidates && candidates.length > 1
      ? { unresolvedRef: ref, ambiguous: true, candidates }
      : { unresolvedRef: ref },
  };
}

/**
 * Resolve a ref to an entity id.
 * If it does not resolve to exactly one entity, create a Missing placeholder (or reuse the existing
 * one) and return its id; an ambiguous ref's placeholder carries its candidates.
 */
export function resolveOrPlaceholder(
  ref: string,
  _sourceDomain: string,
  allEntities: Entity[],
  placeholders: Map<string, Entity>
): string {
  const resolution = resolveRefDetailed(ref, allEntities);
  if (resolution.status === 'resolved') return resolution.handle;

  // An ambiguous ref names every entity that declares the string, so the reader sees the choice
  // the model left open instead of an edge to one of them.
  const placeholder = createPlaceholder(ref, resolution.status === 'ambiguous' ? resolution.handles : undefined);
  if (!placeholders.has(placeholder.id)) {
    placeholders.set(placeholder.id, placeholder);
  }
  return placeholder.id;
}
