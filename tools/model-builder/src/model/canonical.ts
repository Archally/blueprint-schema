/**
 * Canonical serialization of a blueprint model — the deterministic content form.
 *
 * The problem this solves (review Finding 14, triage item C): `buildBlueprintModel` stamped
 * `last_loaded: new Date().toISOString()` into model metadata, so two builds of byte-identical
 * source produced different output. That breaks content hashes, caching, snapshot tests,
 * reproducible builds, and git diffs of the pre-built `model.json` files.
 *
 * The fix is not to delete the timestamp — consumers legitimately display "last loaded". It is to
 * separate **content** from **execution metadata**, and to define exactly one canonical byte form
 * of the content. That form is what gets hashed (see `fingerprint.ts`).
 *
 * Excluded from the canonical form, and why:
 *   - `metadata.last_loaded`      — wall-clock of the build, not a property of the model
 *   - `metadata.files[].lastModified` — filesystem mtime; changes on checkout, content does not
 *   - `metadata.validation` / `metadata.migrationValidation` — *derived verdicts*, not content.
 *     Including them would give the same source two different digests depending on whether the
 *     caller happened to run validation first.
 *
 * Everything else is content and participates. Entities and relations are sorted by `id` and all
 * object keys are emitted in sorted order, so neither file traversal order nor key insertion order
 * can change the bytes (review Finding 16's determinism half).
 */

import type { BlueprintModel } from './types.js';

/** Metadata keys that describe the build run rather than the model's content. */
export const EXECUTION_METADATA_KEYS = ['last_loaded'] as const;

/** Derived verdicts attached to metadata by some callers; excluded so digests stay caller-independent. */
export const DERIVED_METADATA_KEYS = ['validation', 'migrationValidation'] as const;

/** Per-file keys that reflect the filesystem rather than file content. */
const NON_CONTENT_FILE_KEYS = ['lastModified'] as const;

/**
 * Recursively emit a value with object keys in sorted order.
 * `undefined` object properties are dropped (matching `JSON.stringify` semantics) so that an
 * explicitly-undefined field and an absent field canonicalize identically.
 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    result[key] = sortValue(source[key]);
  }
  return result;
}

function omit<T extends Record<string, unknown>>(source: T, keys: readonly string[]): T {
  const result = { ...source };
  for (const key of keys) delete result[key];
  return result;
}

/**
 * The deterministic content view of a model: execution metadata stripped, entities and relations
 * in a stable order. Returned as a plain object so callers can inspect or re-serialize it.
 */
export function canonicalModelContent(model: BlueprintModel): Record<string, unknown> {
  const metadata = omit(
    model.metadata as unknown as Record<string, unknown>,
    [...EXECUTION_METADATA_KEYS, ...DERIVED_METADATA_KEYS]
  );

  if (Array.isArray(metadata.files)) {
    metadata.files = (metadata.files as Array<Record<string, unknown>>)
      .map((file) => omit(file, NON_CONTENT_FILE_KEYS))
      .slice()
      .sort((a, b) => String(a.path ?? '').localeCompare(String(b.path ?? '')));
  }

  return {
    entities: model.entities.slice().sort((a, b) => a.id.localeCompare(b.id)),
    relations: model.relations.slice().sort((a, b) => a.id.localeCompare(b.id)),
    metadata,
  };
}

/**
 * Canonical JSON bytes for a model. Identical source ⇒ identical string, regardless of file
 * traversal order, key insertion order, or when the build ran.
 */
export function canonicalizeModel(model: BlueprintModel): string {
  return JSON.stringify(sortValue(canonicalModelContent(model)));
}

/**
 * Canonical JSON bytes for the *source* documents a model was built from — the input-side digest.
 * Keyed by schema type then file path so neither grouping nor discovery order matters.
 */
export function canonicalizeSource(documentsByType: Record<string, Array<{ filePath?: string; data: unknown }>>): string {
  const byPath: Record<string, unknown> = {};
  for (const [schemaType, documents] of Object.entries(documentsByType)) {
    for (const document of documents) {
      byPath[`${schemaType}:${document.filePath ?? ''}`] = document.data;
    }
  }
  return JSON.stringify(sortValue(byPath));
}
