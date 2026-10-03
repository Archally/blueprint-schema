import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { resolveRefDetailed, createPlaceholder } from './resolver.js';
import type { RefResolution } from './refResolution.js';
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
 * How a `model_ref` resolves: to one entity (`resolved`), to several (`ambiguous`, every candidate
 * listed and sorted) or to none (`unresolved`).
 *
 * Order matches the schema's own preference: typed id first, then component name, then pointer.
 * The typed id is resolved by the shared resolution function, so it names the entity declared with
 * the same string; a string several entities declare is ambiguous and is not retried as a name.
 * A pointer is matched on BOTH name and section, because a pointer is a path - `#/components/
 * schemas/X` does not address an `X` that lives under `x-field`. A form-4 ref's file part keeps only
 * the components of the file it names. Whatever several components still satisfy is ambiguous: the
 * folder the reference is written in is not part of the reference, and neither is the order the
 * components were extracted in.
 */
export function resolveModelRefDetailed(ref: string, entities: Entity[], models: Entity[]): RefResolution {
  // 1. typed id / displayId (handles scoped ids like `billing.MDL013`).
  const byId = resolveRefDetailed(ref, entities);
  if (byId.status !== 'unresolved') return byId;

  // 2, 3 & 4. Name, pointer and file-relative pointer - one definition, in `modelRefMatch.ts`,
  // because the zero-build validator answers the same question from the same rules.
  const candidates = [...new Set(models.filter((m) => matchesModelRef(ref, asComponent(m))).map((m) => m.id))].sort();
  if (candidates.length === 0) return { status: 'unresolved' };
  if (candidates.length === 1) return { status: 'resolved', handle: candidates[0]! };
  return { status: 'ambiguous', handles: candidates };
}

/**
 * Resolve a `model_ref` in any of the four documented forms to an entity id, or `null` when it
 * resolves to no single entity.
 *
 * `sourceDomain` is accepted so every call site keeps its shape, and is not read: the folder a
 * reference is written in is not part of the reference.
 */
export function resolveModelRef(
  ref: string,
  _sourceDomain: string,
  entities: Entity[],
  models: Entity[],
): string | null {
  const resolution = resolveModelRefDetailed(ref, entities, models);
  return resolution.status === 'resolved' ? resolution.handle : null;
}

/**
 * Resolve a `model_ref` in any of the four documented forms, falling back to a shared Missing
 * placeholder - the whole of what a `model_ref` call site needs. An ambiguous ref's placeholder
 * lists every candidate.
 *
 * Every call site takes this entry point rather than `resolveOrPlaceholder` from `resolver.ts`,
 * which resolves by typed id alone and so would answer forms 2, 3 and 4 with a placeholder naming a
 * component the model does declare.
 *
 * The model set is derived here rather than passed in, so a call site cannot supply a narrower one
 * than the resolver assumes and get a placeholder for a component that exists.
 */
export function resolveModelRefOrPlaceholder(
  ref: string,
  _sourceDomain: string,
  entities: Entity[],
  placeholders: Map<string, Entity>,
  models?: Entity[],
): string {
  const candidates = models ?? entities.filter((e) => e.type === ENTITY_TYPE.Models);
  const resolution = resolveModelRefDetailed(ref, entities, candidates);
  if (resolution.status === 'resolved') return resolution.handle;

  const placeholder = createPlaceholder(ref, resolution.status === 'ambiguous' ? resolution.handles : undefined);
  if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
  return placeholder.id;
}
