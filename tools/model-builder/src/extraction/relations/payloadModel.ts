import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveRef, createPlaceholder } from './resolver.js';

/**
 * Extract operation → model relations from an operation's payload.schema (a model_ref),
 * wiring the design/domain plane to the design/models plane so a payload's data model is a
 * first-class edge (an operation "carries" its payload model).
 *
 * payload.schema is a model_ref in one of two common forms:
 *   - typed MDL id ("MDL013" / "billing.MDL013")  → matched against a model entity's displayId
 *   - components.schemas key (PascalCase "OrderPayload") → matched against the model entity's
 *     term / _schemaName (a model with an x-model-id uses the MDL id as displayId, so the key is
 *     only available via term)
 * Unresolvable refs become shared Missing placeholders, as elsewhere.
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
    const targetId = resolvePayloadModel(ref, domain, entities, models, placeholders);
    relations.push({
      id: `${entity.id}--${RELATION_TYPE.PayloadModel}--${targetId}`,
      source_entity_id: entity.id,
      target_entity_id: targetId,
      type: RELATION_TYPE.PayloadModel,
    });
  }

  return relations;
}

function resolvePayloadModel(
  ref: string,
  domain: string,
  entities: Entity[],
  models: Entity[],
  placeholders: Map<string, Entity>
): string {
  // 1. typed id / displayId form (handles scoped ids like "billing.MDL013").
  const byId = resolveRef(ref, domain, entities);
  if (byId) return byId;

  // 2. components.schemas key (PascalCase) — match term / _schemaName, prefer same domain.
  const byTerm = models.filter(
    (m) => m.term === ref || (m.data as Record<string, unknown> | undefined)?._schemaName === ref
  );
  if (byTerm.length > 0) {
    const inDomain = byTerm.find((m) => entityDomain(m) === domain);
    return (inDomain ?? byTerm[0]!).id;
  }

  // 3. unresolvable → shared Missing placeholder.
  const placeholder = createPlaceholder(ref);
  if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
  return placeholder.id;
}
