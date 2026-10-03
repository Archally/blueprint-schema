/**
 * How a reference resolves - stated once, with no dependencies.
 *
 * A reference resolves to the declaration whose id is THE SAME STRING, and to nothing else. A scope
 * prefix and its dot are part of the id: `orders.RSK001` and `RSK001` are two ids, so neither
 * resolves to the other, in either direction. Nothing here splits a string, prepends a scope,
 * matches a tail, prefers a folder or picks the first of several candidates.
 *
 * Containment is the one other input, and the caller passes it; it is never read from the string.
 * Two kinds of id are unique only within a container: an activity within its parent, and, on the
 * lines whose `attribute_ref` admits no prefix, a bare concept attribute within its bounded context.
 * The caller states the container of each such declaration, and the container a reference is
 * written in.
 *
 * The answer is `resolved` (one handle), `ambiguous` (every handle, sorted) or `unresolved`. Each
 * surface words it: the validator reports a missing reference exactly when the answer is
 * `unresolved`; the model builder draws an edge only for `resolved`.
 *
 * The model builder imports this module as TypeScript; the validator runs a generated plain-ESM
 * copy of it, so the two cannot answer the same reference differently.
 */

/** One declaration of an id, as the caller describes it. */
export interface RefDeclaration {
  /** The id exactly as declared - prefix included. */
  id: string;
  /**
   * An opaque string the caller maps back to what it declared (an entity id, a file location).
   * Several declarations carrying the same handle are one declaration: a party re-declared across
   * slices is one party when its declarations share a handle.
   */
  handle: string;
  /** The container this id is unique within, when it is unique only within one. */
  containment?: string;
}

interface IndexedDeclaration {
  handle: string;
  containment?: string;
}

/** Every declaration, keyed by its id string. Build it once per model. */
export interface RefIndex {
  readonly byId: ReadonlyMap<string, ReadonlyArray<IndexedDeclaration>>;
}

export type RefResolution =
  | { status: 'resolved'; handle: string }
  | { status: 'ambiguous'; handles: string[] }
  | { status: 'unresolved' };

const UNRESOLVED: RefResolution = Object.freeze({ status: 'unresolved' }) as RefResolution;

/** Index declarations by their id string, exactly as written. */
export function indexDeclarations(declarations: Iterable<RefDeclaration>): RefIndex {
  const byId = new Map<string, IndexedDeclaration[]>();
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.id !== 'string' || declaration.id.length === 0) continue;
    let entries = byId.get(declaration.id);
    if (!entries) {
      entries = [];
      byId.set(declaration.id, entries);
    }
    entries.push(
      declaration.containment === undefined
        ? { handle: declaration.handle }
        : { handle: declaration.handle, containment: declaration.containment },
    );
  }
  return { byId };
}

/**
 * Resolve one reference. With `containment` given, only declarations stated in that container
 * count; without it, every declaration of the same string counts.
 */
export function resolveReference(index: RefIndex, reference: string, containment?: string): RefResolution {
  if (typeof reference !== 'string' || reference.length === 0) return UNRESOLVED;
  const candidates = index.byId.get(reference);
  if (!candidates) return UNRESOLVED;
  const handles = new Set<string>();
  for (const candidate of candidates) {
    if (containment !== undefined && candidate.containment !== containment) continue;
    handles.add(candidate.handle);
  }
  if (handles.size === 0) return UNRESOLVED;
  const sorted = [...handles].sort();
  if (sorted.length === 1) return { status: 'resolved', handle: sorted[0]! };
  return { status: 'ambiguous', handles: sorted };
}

/** A scope prefix: a lower-case slice or subdomain name followed by a dot. */
const SLICE_PREFIX = /^([a-z][a-z0-9-]*)\./;

/**
 * The slice or subdomain a qualified id names, or null for an id without a prefix.
 *
 * This READS a prefix as information about where an id belongs - for grouping, placement or a
 * "did you mean" hint. It is never an input to resolution: `resolveReference` does not call it,
 * and an id's identity is its whole string.
 */
export function slicePrefixOf(id: string): string | null {
  const match = typeof id === 'string' ? SLICE_PREFIX.exec(id) : null;
  return match ? match[1]! : null;
}
