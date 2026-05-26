import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

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
 * Resolve a typed ref string to an existing entity's internal id.
 *
 * Resolution order:
 * 1. Exact match: full ref string matches an entity's displayId (handles scoped displayIds like "checkout.CN001").
 * 2. Split match: split ref on first dot into domain + bareId, match bareId against displayId, prefer same domain.
 * 3. Global fallback: first entity with matching bareId displayId in any domain.
 * 4. Returns null if no match — caller creates a Missing placeholder.
 *
 * Handles scoped refs like "billing.CN001" by splitting on the first dot.
 */
export function resolveRef(
  ref: string,
  sourceDomain: string,
  allEntities: Entity[]
): string | null {
  if (!ref) return null;

  // 1. For scoped refs (contain a dot): try exact displayId match first.
  //    Handles entities with scoped displayIds like "checkout.CN001".
  if (ref.indexOf('.') > 0) {
    const exactMatch = allEntities.find((e) => e.displayId === ref);
    if (exactMatch) return exactMatch.id;
  }

  // 2. Split on first dot and try bare displayId match
  let domain: string;
  let displayId: string;

  const dotIdx = ref.indexOf('.');
  if (dotIdx > 0) {
    domain = ref.substring(0, dotIdx);
    displayId = ref.substring(dotIdx + 1);
  } else {
    domain = sourceDomain;
    displayId = ref;
  }

  const candidates = allEntities.filter((e) => e.displayId === displayId);
  if (candidates.length === 0) return null;

  // Prefer entity from expected domain
  const inDomain = candidates.find((e) => entityDomain(e) === domain);
  if (inDomain) return inDomain.id;

  // Global fallback: return first match regardless of domain
  return candidates[0]!.id;
}

/**
 * Create a placeholder "Missing" entity for an unresolvable ref.
 * The id is deterministic: missing-{sanitized-ref}.
 * Multiple sources referencing the same unresolvable ref share one placeholder.
 */
export function createPlaceholder(ref: string): Entity {
  const sanitized = ref.replace(/[^a-zA-Z0-9]/g, '-');
  return {
    id: `missing-${sanitized}`,
    displayId: ref,
    type: ENTITY_TYPE.Missing,
    layer: 'unknown',
    fileOrigin: '',
    data: { unresolvedRef: ref },
  };
}

/**
 * Resolve a ref to an entity id.
 * If not found, create a Missing placeholder (or reuse existing one) and return its id.
 */
export function resolveOrPlaceholder(
  ref: string,
  sourceDomain: string,
  allEntities: Entity[],
  placeholders: Map<string, Entity>
): string {
  const resolved = resolveRef(ref, sourceDomain, allEntities);
  if (resolved) return resolved;

  const placeholder = createPlaceholder(ref);
  if (!placeholders.has(placeholder.id)) {
    placeholders.set(placeholder.id, placeholder);
  }
  return placeholder.id;
}
