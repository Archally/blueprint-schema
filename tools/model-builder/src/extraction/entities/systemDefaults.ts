import type { ParsedBlueprintDocument } from '../../model/types.js';

/**
 * The document's `system_ref` default, written onto the services that inherit it.
 *
 * An arch document root may carry `system_ref`: the system party every service under a ROOT-DECLARED
 * context in that document is a component of, unless the service names its own. This is the second
 * header-inherited key after `owned_by`, and it rides the same mechanism: the document is annotated
 * BEFORE extraction, the marker is a separate key from the declaration so a consumer can still tell
 * what the model said from what it inherited, and the relation built from the marker carries
 * `data.inherited`.
 *
 * Two rules, narrower than ownership's because the schema is narrower here:
 *
 * **Only a service under a root-declared context inherits.** A service nested under a party is a
 * component of that party by position, and the schema says it does not read the default; annotating
 * it would attach a second system to a service that already has one, which is the contradiction the
 * reference walk reports when an author writes it.
 *
 * **A service that names its own `system_ref` is left alone**, whatever it names. The default fills
 * silence; it never overrides a statement.
 */

/** The key an inherited `system_ref` is written under. */
export const SYSTEM_REF_DEFAULT = '_system_ref_default';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Write the document's `system_ref` default onto every root-declared context's service that names no
 * system of its own. Mutates `doc.data` in place, for the reason `annotateOwnershipDefaults` does:
 * the extractor spreads the node, so a copy would not reach it. Idempotent, and a no-op for a
 * document with no root `system_ref` or no root `contexts`.
 */
export function annotateSystemDefaults(doc: ParsedBlueprintDocument): void {
  const root = doc.data;
  if (!isRecord(root)) return;
  const systemRef = root.system_ref;
  if (typeof systemRef !== 'string' || systemRef.length === 0) return;
  if (!Array.isArray(root.contexts)) return;

  for (const context of root.contexts) {
    if (!isRecord(context) || !Array.isArray(context.services)) continue;
    for (const service of context.services) {
      if (!isRecord(service)) continue;
      if (typeof service.system_ref === 'string' && service.system_ref.length > 0) continue;
      service[SYSTEM_REF_DEFAULT] = systemRef;
    }
  }
}
