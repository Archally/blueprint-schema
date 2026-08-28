import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, createPlaceholder } from './resolver.js';
import { resolveModelRef } from './modelRef.js';

/**
 * Extract operation → model relations from an operation's payload.schema (a model_ref),
 * wiring the design/domain plane to the design/models plane so a payload's data model is a
 * first-class edge (an operation "carries" its payload model).
 *
 * payload.schema is a `model_ref`, and ALL FOUR documented forms resolve - typed id, component
 * name, JSON Pointer and file-relative JSON Pointer. The form handling lives in `modelRef.ts`,
 * because the same ref type appears on `parameter.schema`, `expected_result.model.$ref` and
 * `responses[].schema`; a second call site must not become a second implementation.
 * Genuinely unresolvable refs become shared Missing placeholders, as elsewhere.
 */
export function extractPayloadModelRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];
  const models = entities.filter((e) => e.type === ENTITY_TYPE.Models);

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Operation) continue;
    const data = entity.data as Record<string, unknown> | undefined;
    const payload = data?.payload as Record<string, unknown> | undefined;
    const ref = payload?.schema;
    if (typeof ref !== 'string' || !ref) continue;

    const domain = entityDomain(entity);
    const targetId = resolveOrPlaceholder(ref, domain, entities, models, placeholders);
    relations.push({
      id: `${entity.id}--${RELATION_TYPE.PayloadModel}--${targetId}`,
      source_entity_id: entity.id,
      target_entity_id: targetId,
      type: RELATION_TYPE.PayloadModel,
    });
  }

  return relations;
}

/** Resolve through `modelRef.ts`, falling back to a shared Missing placeholder. */
function resolveOrPlaceholder(
  ref: string,
  domain: string,
  entities: Entity[],
  models: Entity[],
  placeholders: Map<string, Entity>
): string {
  const resolved = resolveModelRef(ref, domain, entities, models);
  if (resolved) return resolved;

  const placeholder = createPlaceholder(ref);
  if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
  return placeholder.id;
}
