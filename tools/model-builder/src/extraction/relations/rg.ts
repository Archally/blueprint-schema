import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Extract rg-derived relations from the entity list.
 *
 * - DeploymentTier --contains--> RG resource
 *     Match tier.data._tier_services[] entries against RG entities in the
 *     SAME fileOrigin by displayId.
 *
 * - RG resource --owned-by-team--> Team
 *     Match resource.data.owner.team (a Team displayId, e.g. "TM001") against
 *     any Team entity in the model. Team displayIds are conventionally
 *     globally unique within a project, so cross-file matching is safe.
 *
 * - Service --deployed-in-tier--> DeploymentTier
 *     Match tier.data._tier_services[] entries against arch Service entities
 *     by displayId. Cross-file (arch.yaml services placed in rg.yaml tiers).
 *     Excludes entries already matched as resources in the same file (those
 *     are already covered by the contains edge above).
 *
 * Unresolvable refs are silently dropped (no Missing placeholders) — rg
 * topology referencing absent services is a soft warning concern handled by
 * the validation layer, not a graph-structural error.
 */
export function extractRgRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  // Index Team entities globally by displayId.
  const teamByDisplayId = new Map<string, Entity>();
  for (const e of entities) {
    if (e.type === ENTITY_TYPE.Team) {
      teamByDisplayId.set(e.displayId, e);
    }
  }

  // Index Service entities globally by displayId. Services come from arch.yaml.
  // If multiple services share a displayId across contexts, the first one wins
  // (consistent with resolveRef's "global fallback" behavior).
  const serviceByDisplayId = new Map<string, Entity>();
  for (const e of entities) {
    if (e.type === ENTITY_TYPE.Service && !serviceByDisplayId.has(e.displayId)) {
      serviceByDisplayId.set(e.displayId, e);
    }
  }

  // Index RG resources per fileOrigin so Tier→Resource matching stays scoped.
  const rgByFileAndDisplayId = new Map<string, Map<string, Entity>>();
  for (const e of entities) {
    if (e.type !== ENTITY_TYPE.RG) continue;
    const file = e.fileOrigin ?? '';
    if (!rgByFileAndDisplayId.has(file)) rgByFileAndDisplayId.set(file, new Map());
    rgByFileAndDisplayId.get(file)!.set(e.displayId, e);
  }

  for (const e of entities) {
    if (e.type === ENTITY_TYPE.RG) {
      const owner = (e.data as Record<string, unknown> | undefined)?.owner as
        | Record<string, unknown>
        | undefined;
      const teamRef = owner?.team as string | undefined;
      if (teamRef) {
        const team = teamByDisplayId.get(teamRef);
        if (team) {
          relations.push({
            id: `${e.id}--${RELATION_TYPE.OwnedByTeam}--${team.id}`,
            source_entity_id: e.id,
            target_entity_id: team.id,
            type: RELATION_TYPE.OwnedByTeam,
          });
        }
      }
    }

    if (e.type === ENTITY_TYPE.DeploymentTier) {
      const tierFile = e.fileOrigin ?? '';
      const services = (e.data as Record<string, unknown> | undefined)?._tier_services as
        | string[]
        | undefined;
      if (!Array.isArray(services)) continue;

      const localResources = rgByFileAndDisplayId.get(tierFile) ?? new Map<string, Entity>();
      for (const ref of services) {
        const resource = localResources.get(ref);
        if (resource) {
          relations.push({
            id: `${e.id}--${RELATION_TYPE.Contains}--${resource.id}`,
            source_entity_id: e.id,
            target_entity_id: resource.id,
            type: RELATION_TYPE.Contains,
          });
          continue;
        }
        const service = serviceByDisplayId.get(ref);
        if (service) {
          relations.push({
            id: `${service.id}--${RELATION_TYPE.DeployedInTier}--${e.id}`,
            source_entity_id: service.id,
            target_entity_id: e.id,
            type: RELATION_TYPE.DeployedInTier,
          });
        }
      }
    }
  }

  return relations;
}
