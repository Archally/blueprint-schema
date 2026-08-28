import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Resolution for `operation_ref`, which is the ONE ref type in the schema with two legal shapes.
 *
 * `metamodel.schema.yaml`'s `operation_ref` is an `anyOf` of two patterns:
 *
 *   (1) ID-based    `CMD001`, `orders.CMD001`     - machine-stable, handled by `resolveRef`
 *   (2) domain:key  `orders:placeOrder`           - human-readable, handled here
 *
 * Only format 1 was ever implemented. Measured 2026-08-27 on prestashop: all 38 of its service
 * contract refs are format 2, all 38 became `Missing` placeholders, and
 * `contract-operation-missing-exchange` - a rule whose description promises "zero false positives" -
 * reported nothing on a model with 38 contract-wired operations and no `exchange` block anywhere.
 * A rule keyed on a relation cannot fire when the relation lands on a placeholder.
 *
 * ## Why this is not in `resolveRef`
 *
 * `resolveRef` serves every typed ref in the model - concepts, rules, decisions, models. Format 2 is
 * defined on `operation_ref` ALONE. Teaching the generic resolver a colon form would silently accept
 * `orders:something` wherever a `concept_ref` or `rule_ref` is expected, turning a schema violation
 * into a resolved edge. The narrower home is the point of the file.
 *
 * ## Why this does not derive the key from `name`
 *
 * The generator derives it (`viewer/generator/v2.6/src/utils/operation-key.ts`) because its
 * `ResolvedOperation` is built from a different shape and has no key to carry. This side does: the
 * builder parses the operations map and the key IS the second half of the ref. It used to be dropped
 * whenever `op.id` was present; `entities/domain.ts` now keeps it as `_operation_key`.
 *
 * That distinction is load-bearing. The generator's own header records FOUR independent
 * implementations of the name-to-key derivation, THREE of them wrong in the same way, and 25 sequence
 * diagrams drawn with a single lifeline as the result. A fifth copy here would repeat it. Retaining a
 * parsed value cannot drift from itself.
 */

/** `<domain>:<camelCaseKey>` - the schema's format 2, anchored so a stray colon cannot match. */
const DOMAIN_KEY_REF = /^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9]*$/;

/** Whether a ref string is written in the `domain:key` form. */
export function isDomainKeyRef(ref: string): boolean {
  return DOMAIN_KEY_REF.test(ref);
}

/**
 * Index Operation entities by every `<domain>:<key>` that may legally address them.
 *
 * A domain is taken from BOTH the entity's declared `_scope` and its file-origin directory, because
 * either can be what an author means by `domainRef` and in practice they agree. An entry that two
 * different operations could claim maps to `null`: an ambiguous ref is left unresolved so it surfaces
 * as a placeholder, rather than being silently bound to whichever entity was extracted first.
 */
export function buildOperationKeyIndex(entities: Entity[]): Map<string, string | null> {
  const index = new Map<string, string | null>();

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Operation) continue;
    const data = entity.data as Record<string, unknown> | undefined;
    const key = data?._operation_key;
    if (typeof key !== 'string' || !key) continue;

    const scope = typeof data?._scope === 'string' ? data._scope : undefined;
    const domains = new Set([entityDomain(entity), scope].filter((d): d is string => !!d));

    for (const domain of domains) {
      const refKey = `${domain}:${key}`;
      const existing = index.get(refKey);
      if (existing === undefined) index.set(refKey, entity.id);
      else if (existing !== entity.id) index.set(refKey, null); // ambiguous: decline, do not guess
    }
  }

  return index;
}

/**
 * Resolve an `operation_ref` in either documented format, falling back to a shared placeholder.
 *
 * Format 2 is tried first and only when the string is actually written that way, so a model using
 * format 1 throughout takes exactly the path it took before this existed.
 */
export function resolveOperationRefOrPlaceholder(
  ref: string,
  sourceDomain: string,
  allEntities: Entity[],
  placeholders: Map<string, Entity>,
  keyIndex: Map<string, string | null>,
): string {
  if (isDomainKeyRef(ref)) {
    const resolved = keyIndex.get(ref);
    if (resolved) return resolved;
  }
  return resolveOrPlaceholder(ref, sourceDomain, allEntities, placeholders);
}
