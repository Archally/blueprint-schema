import type { ParsedBlueprintDocument } from '../../model/types.js';

/**
 * The document's `domain_ref` header, written onto every operation in it.
 *
 * A domain document root may carry `domain_ref`: the problem-space domain every operation below it
 * belongs to. This is the third header-inherited key after `owned_by` and `system_ref`, and it
 * rides the same mechanism - the document is annotated BEFORE extraction, so each extractor carries
 * the value through its own identity logic, and the marker is a separate key from the declaration.
 *
 * It differs from the first two in one way worth stating, because it is the reason no "does the
 * entity declare its own?" check appears below: an operation has NO `domain_ref` of its own to
 * override the header with. That was the decision - a domain file describes one domain, so one
 * header line replaces a reference repeated on every operation in the corpus. A default that fills
 * silence is the shape the other two need because their entities may speak; here the header is the
 * only speaker, so the annotation is unconditional.
 *
 * `operations:` is a dictionary in the current schema and an array in older models, and both are
 * annotated: the entity extractor accepts both forms, so a marker written to only one of them would
 * reach some models and not others for no reason an author could see.
 */

/** The key an inherited document `domain_ref` is written under. */
export const DOMAIN_REF_DEFAULT = '_domain_ref_default';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Write the document's `domain_ref` onto every operation it declares. Mutates `doc.data` in place,
 * for the reason `annotateOwnershipDefaults` does: the extractor spreads the operation node, so a
 * copy would not travel. Idempotent, and a no-op for a document with no root `domain_ref` - which
 * is every document in every model until one is authored.
 */
export function annotateDomainDefaults(doc: ParsedBlueprintDocument): void {
  const root = doc.data;
  if (!isRecord(root)) return;
  const domainRef = root.domain_ref;
  if (typeof domainRef !== 'string' || domainRef.length === 0) return;

  const operations = root.operations;
  if (Array.isArray(operations)) {
    for (const operation of operations) {
      if (isRecord(operation)) operation[DOMAIN_REF_DEFAULT] = domainRef;
    }
    return;
  }
  if (isRecord(operations)) {
    for (const operation of Object.values(operations)) {
      if (isRecord(operation)) operation[DOMAIN_REF_DEFAULT] = domainRef;
    }
  }
}
