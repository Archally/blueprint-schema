import type { Entity } from '../../model/types.js';
import { entityDomain, resolveRef } from './resolver.js';
import { matchesModelRef, parseModelPointer, type ModelComponentRef } from './modelRefMatch.js';

export { parseModelPointer } from './modelRefMatch.js';

/**
 * Resolution for `model_ref`, the ref type with FOUR documented forms.
 *
 * `metamodel.schema.yaml` (`$defs.model_ref`) admits all four, and says forms 2-4 exist "for
 * OpenAPI/AsyncAPI interop where models mirror external spec component names":
 *
 *   (1) typed id            `MDL013`, `billing.MDL013`
 *   (2) component name      `OrderSchema`
 *   (3) JSON Pointer        `#/components/schemas/OrderSchema`
 *   (4) file-relative JSON Pointer  `./models.yaml#/components/schemas/OrderSchema`
 *
 * Only forms 1 and 2 were implemented, and the old resolver's own comment said so - "a model_ref in
 * one of two common forms" - while the schema promised four. Measured 2026-08-27: every one of
 * `ecommerce`'s six `payload.schema` refs is form 3, every one names a component that EXISTS, and
 * every one resolved to a `Missing` placeholder. `bp model` reported 6 `payload_model` edges that
 * reached nothing, and a checker rule written against those placeholders would have reported six
 * authoring defects for one resolver gap.
 *
 * Lives in its own module rather than inside `payloadModel.ts` because `model_ref` is not a payload
 * concept: `parameter.schema`, `expected_result.model.$ref` and `responses[].schema` are the same
 * ref type, and a second call site must not become a second implementation. Same reasoning as
 * `operationRef.ts` for `operation_ref`.
 */

/** Describe a model entity in the terms the shared form rules take. */
function asComponent(model: Entity): ModelComponentRef {
  const data = (model.data ?? {}) as Record<string, unknown>;
  const name = model.term ?? (typeof data._schemaName === 'string' ? data._schemaName : '');
  return {
    name,
    category: typeof data._modelCategory === 'string' ? data._modelCategory : '',
    modelId: typeof data['x-model-id'] === 'string' ? data['x-model-id'] : undefined,
    file: model.fileOrigin,
  };
}

/**
 * Resolve a `model_ref` in any of the four documented forms to an entity id, or `null`.
 *
 * Order matches the schema's own preference: typed id first, then component name, then pointer.
 * A pointer is matched on BOTH name and section, because a pointer is a path - `#/components/
 * schemas/X` does not address an `X` that lives under `x-field`. When a form-4 ref names a file,
 * a model from that file wins; that is the only thing the file part is for, and without it two
 * files declaring the same component name would resolve to whichever was extracted first.
 */
export function resolveModelRef(
  ref: string,
  sourceDomain: string,
  entities: Entity[],
  models: Entity[],
): string | null {
  // 1. typed id / displayId (handles scoped ids like `billing.MDL013`).
  const byId = resolveRef(ref, sourceDomain, entities);
  if (byId) return byId;

  // 2, 3 & 4. Name, pointer and file-relative pointer - one definition, in `modelRefMatch.ts`,
  // because the zero-build validator answers the same question from the same rules.
  const candidates = models.filter((m) => matchesModelRef(ref, asComponent(m)));
  if (candidates.length === 0) return null;

  // A form-4 reference names its file, and the shared predicate has already honoured it; what is
  // left to decide is only which of several same-named candidates a caller meant.
  return preferred(candidates, sourceDomain).id;
}

/** Same-domain candidate when there is one, else the first - the house rule for ambiguous refs. */
function preferred(candidates: Entity[], sourceDomain: string): Entity {
  return candidates.find((m) => entityDomain(m) === sourceDomain) ?? candidates[0]!;
}
