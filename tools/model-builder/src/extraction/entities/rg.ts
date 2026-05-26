import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['rg']!;

/**
 * Extract RG (infrastructure resource) entities and DeploymentTier entities from one rg document.
 *
 * Schema shape:
 *   resources: [{ id, kind, name, summary, platform, owner: { team }, environments, ... }]
 *   topology:
 *     tiers: [{ name, description, services: [string], region, replicas }]
 *
 * Each resource becomes an RG entity. Each topology tier becomes a DeploymentTier entity.
 *
 * Tier entities carry `_tier_services` (the raw service id list) and `_resource_displayids`
 * (the set of resource displayIds in the same file) on `data` so the rg relation extractor
 * can compute Tier→Resource and Service→Tier edges without re-reading the document.
 */
export function extractRg(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const resources = data.resources as Array<Record<string, unknown>> | undefined;
  const resourceDisplayIds: string[] = [];

  if (Array.isArray(resources)) {
    for (const resource of resources) {
      const resourceId = resource.id as string | undefined;
      if (!resourceId) continue;

      resourceDisplayIds.push(resourceId);
      const internalId = makeInternalId(doc.scope, doc.filePath, resourceId);
      entities.push({
        id: internalId,
        displayId: resourceId,
        type: ENTITY_TYPE.RG,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: (resource.summary as string) ?? (resource.name as string) ?? undefined,
        data: { ...resource },
      });
    }
  }

  const topology = data.topology as Record<string, unknown> | undefined;
  const tiers = topology?.tiers as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tiers)) {
    for (const tier of tiers) {
      const tierName = tier.name as string | undefined;
      if (!tierName) continue;

      const tierServices = Array.isArray(tier.services) ? (tier.services as string[]) : [];
      const internalId = makeInternalId(doc.scope, doc.filePath, `tier.${tierName}`);
      entities.push({
        id: internalId,
        displayId: tierName,
        type: ENTITY_TYPE.DeploymentTier,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: tier.description as string | undefined,
        data: {
          ...tier,
          _tier_services: tierServices,
          _resource_displayids: resourceDisplayIds,
        },
      });
    }
  }

  return entities;
}
