/** Which keys hold a typed reference, derived from a schema tree - see reference-keys.mjs. */
export interface ReferenceKeys {
  /** `parent/key` -> the reference definitions the schema types it as. */
  pairs: Map<string, Set<string>>;
  /** Every key that is a reference under at least one parent. */
  keys: Set<string>;
  isReference(parent: string, key: string): boolean;
  defsOf(parent: string, key: string): Set<string>;
  /** The `scope:key` spelling is legal under this parent and key. */
  acceptsKeyedForm(parent: string, key: string): boolean;
}

/** @param registry schema documents keyed by path relative to the schema root, POSIX separators. */
export function deriveReferenceKeys(registry: Map<string, unknown>): ReferenceKeys;
