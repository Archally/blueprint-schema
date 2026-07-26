/**
 * Model fingerprints — "which exact model grounded this output?" (review Finding 15, triage item D).
 *
 * Why this matters more here than in a typical library: the primary consumer of this model is an
 * AI agent. When an agent asserts something about an architecture, or a generator emits a contract,
 * the artifact should be able to name the model state it was derived from. Without a digest, a
 * generated file and a claim about the model are both unfalsifiable after the fact.
 *
 * Depends on `canonical.ts` for determinism: hashing a non-canonical model would produce a
 * different digest per build and be worse than no digest at all, because it would *look* stable.
 */

import type { BlueprintModel } from './types.js';
import { canonicalizeModel, canonicalizeSource } from './canonical.js';
import { sha256Hex } from './sha256.js';

/**
 * Identifies a model state. `sourceDigest` answers "did the YAML change?"; `modelDigest` answers
 * "did the built graph change?" — they differ when the builder itself changes (a new extractor
 * makes new entities appear from unchanged source, exactly as `Finding` did in step-11/D41).
 */
export interface BlueprintFingerprint {
  /** Blueprint schema version the model was authored against, when known. */
  schemaVersion?: string;
  /** Version of the builder that produced the model, when known. */
  toolVersion?: string;
  /** sha256 over canonical source documents, `sha256:` prefixed. Absent when sources weren't supplied. */
  sourceDigest?: string;
  /** sha256 over the canonical model content, `sha256:` prefixed. */
  modelDigest: string;
}

export interface FingerprintOptions {
  schemaVersion?: string;
  toolVersion?: string;
  /** The documents the model was built from; supply to get a `sourceDigest`. */
  documentsByType?: Record<string, Array<{ filePath?: string; data: unknown }>>;
}

/** `sha256:<hex>` over a canonical string. */
function digest(canonical: string): string {
  return `sha256:${sha256Hex(canonical)}`;
}

/** Digest of the canonical model content. Stable across builds of identical source. */
export function modelDigest(model: BlueprintModel): string {
  return digest(canonicalizeModel(model));
}

/** Digest of the canonical source documents. */
export function sourceDigest(
  documentsByType: Record<string, Array<{ filePath?: string; data: unknown }>>
): string {
  return digest(canonicalizeSource(documentsByType));
}

/** Full fingerprint for a model, including the source digest when documents are supplied. */
export function fingerprintModel(
  model: BlueprintModel,
  options: FingerprintOptions = {}
): BlueprintFingerprint {
  return {
    ...(options.schemaVersion != null && { schemaVersion: options.schemaVersion }),
    ...(options.toolVersion != null && { toolVersion: options.toolVersion }),
    ...(options.documentsByType != null && { sourceDigest: sourceDigest(options.documentsByType) }),
    modelDigest: modelDigest(model),
  };
}
