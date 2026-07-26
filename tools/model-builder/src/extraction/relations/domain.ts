import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Extract relations from domain-layer operation entities:
 * - Operation.governed_by[] → governed_by (operation → rule)
 * - Operation.preconditions[] → preconditions (operation → rule)
 * - Operation.postconditions[] → postconditions (operation → rule)
 * - Operation.requires[] → requires (operation → operation)
 * - Operation.produces.operations[] → produces (command → event)
 * - Operation.reacts_to[].operation → reacts_to (operation → triggering operation)
 * - Operation.initiated_by[] → initiated_by (operation → actor)
 * - Operation.materializes[].concept → materializes (operation → concept)
 * - Operation.responses[].error → raises_error (operation → error)
 *
 * The causal five were missing here until 2026-07-25 while the public model-builder had always
 * emitted them — 458 dropped edges on the prestashop model alone. Keep this list in lockstep with
 * `tools/model-builder/src/extraction/relations/domain.ts` in the public repo: both builders feed
 * the same semantic-rule pack, so a divergence makes one rule mean two things.
 */
export function extractDomainRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Operation) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // governed_by[]: { rule: ref, description? }
    const governedBy = data.governed_by as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(governedBy)) {
      for (const entry of governedBy) {
        const ruleRef = entry.rule as string | undefined;
        if (!ruleRef) continue;
        const targetId = resolveOrPlaceholder(ruleRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.GovernedBy}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.GovernedBy,
          data: entry.description != null ? { description: entry.description } : undefined,
        });
      }
    }

    // preconditions[]: { rule: ref, description? }
    const preconditions = data.preconditions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(preconditions)) {
      for (const entry of preconditions) {
        const ruleRef = entry.rule as string | undefined;
        if (!ruleRef) continue;
        const targetId = resolveOrPlaceholder(ruleRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Preconditions}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Preconditions,
          data: entry.description != null ? { description: entry.description } : undefined,
        });
      }
    }

    // postconditions[]: { rule: ref, description? }
    const postconditions = data.postconditions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(postconditions)) {
      for (const entry of postconditions) {
        const ruleRef = entry.rule as string | undefined;
        if (!ruleRef) continue;
        const targetId = resolveOrPlaceholder(ruleRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Postconditions}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Postconditions,
          data: entry.description != null ? { description: entry.description } : undefined,
        });
      }
    }

    // requires[]: plain operation ref strings
    const requires = data.requires as string[] | undefined;
    if (Array.isArray(requires)) {
      for (const ref of requires) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Requires}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Requires,
        });
      }
    }

    // produces: { operations: ref[], mode? }
    const produces = data.produces as Record<string, unknown> | undefined;
    if (produces && Array.isArray(produces.operations)) {
      for (const ref of produces.operations) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Produces}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Produces,
          data: produces.mode != null ? { mode: produces.mode } : undefined,
        });
      }
    }

    // reacts_to[]: { operation: ref, policy?, condition?, rule? }
    const reactsTo = data.reacts_to as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(reactsTo)) {
      for (const entry of reactsTo) {
        const operationRef = entry.operation as string | undefined;
        if (!operationRef) continue;
        const targetId = resolveOrPlaceholder(operationRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.ReactsTo}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.ReactsTo,
          data: entry.policy != null ? { policy: entry.policy } : undefined,
        });
      }
    }

    // initiated_by[]: plain actor ref strings
    const initiatedBy = data.initiated_by as string[] | undefined;
    if (Array.isArray(initiatedBy)) {
      for (const ref of initiatedBy) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.InitiatedBy}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.InitiatedBy,
        });
      }
    }

    // materializes[]: { concept: ref, action, description? }
    const materializes = data.materializes as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(materializes)) {
      for (const entry of materializes) {
        const conceptRef = entry.concept as string | undefined;
        if (!conceptRef) continue;
        const targetId = resolveOrPlaceholder(conceptRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.Materializes}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.Materializes,
          data: { action: entry.action, description: entry.description },
        });
      }
    }

    // responses[].error: operation can raise a catalog error (operation → error)
    const responses = data.responses as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(responses)) {
      const seenErrorTargets = new Set<string>();
      for (const response of responses) {
        const errorRef = (response?.error as string | undefined) ?? undefined;
        if (!errorRef) continue;
        const targetId = resolveOrPlaceholder(errorRef, domain, entities, placeholders);
        if (seenErrorTargets.has(targetId)) continue; // dedupe multiple responses to the same error
        seenErrorTargets.add(targetId);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.RaisesError}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.RaisesError,
        });
      }
    }
  }

  return relations;
}
