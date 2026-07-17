import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['infrastructure']!;

/**
 * Extract v2.7.7 infrastructure entities from one `infrastructure.yaml` document.
 *
 * Superset of the legacy `rg` extractor — the v2.7 layer participates in the knowledge
 * graph with typed ids (de-aliased to layer `design.infrastructure`):
 *
 *   resources[]        → InfraResource (IR###)   — typed id, type_ref, relations, lifecycle,
 *                                                   exposure, identity/access/observability/…
 *   environments[]     → Environment (ENV###)    — object form only (string items are legacy
 *                                                   env-name keys, not entities)
 *   deployment_scopes[]→ DeploymentScope (DSC###) — management/lifecycle partition
 *   bindings[]         → Binding (BND###)         — (type × environment) → module
 *   topology.tiers[]   → DeploymentTier           — grouping VIEW (same type as v2.6)
 *
 * Tiers carry `_tier_services` (legacy free-string list), `_tier_resource_refs` (typed IR###
 * list), and `_resource_displayids` on `data` so the relation extractor can resolve
 * Tier→Resource / Service→Tier without re-reading the document (mirrors `extractRg`).
 *
 * v2.6 `rg.yaml` keeps using `extractRg` (RG entities under `design.rg`) — this extractor is
 * registered only for the `infrastructure` schema-type key.
 */
export function extractInfrastructure(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const resourceDisplayIds: string[] = [];

  // --- resources[] → InfraResource ---
  const resources = data.resources as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(resources)) {
    for (const resource of resources) {
      const resourceId = resource.id as string | undefined;
      if (!resourceId) continue;

      resourceDisplayIds.push(resourceId);
      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, resourceId),
        displayId: resourceId,
        type: ENTITY_TYPE.InfraResource,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: (resource.summary as string) ?? (resource.name as string) ?? undefined,
        data: { ...resource },
      });
    }
  }

  // --- environments[] object form → Environment (string items are legacy names, skipped) ---
  const environments = data.environments as Array<unknown> | undefined;
  if (Array.isArray(environments)) {
    for (const env of environments) {
      if (!env || typeof env !== 'object') continue;
      const envObj = env as Record<string, unknown>;
      const envId = envObj.id as string | undefined;
      if (!envId) continue;

      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, envId),
        displayId: envId,
        type: ENTITY_TYPE.Environment,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: (envObj.name as string) ?? undefined,
        data: { ...envObj },
      });
    }
  }

  // --- deployment_scopes[] → DeploymentScope (DSC###) — management/lifecycle partitions ---
  const deploymentScopes = data.deployment_scopes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(deploymentScopes)) {
    for (const scope of deploymentScopes) {
      const scopeId = scope.id as string | undefined;
      if (!scopeId) continue;

      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, scopeId),
        displayId: scopeId,
        type: ENTITY_TYPE.DeploymentScope,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: (scope.name as string) ?? (scope.summary as string) ?? undefined,
        data: { ...scope },
      });
    }
  }

  // --- bindings[] → Binding ---
  const bindings = data.bindings as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(bindings)) {
    for (const binding of bindings) {
      const bindingId = binding.id as string | undefined;
      if (!bindingId) continue;

      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, bindingId),
        displayId: bindingId,
        type: ENTITY_TYPE.Binding,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: (binding.description as string) ?? undefined,
        data: { ...binding },
      });
    }
  }

  // --- topology.tiers[] → DeploymentTier ---
  const topology = data.topology as Record<string, unknown> | undefined;
  const tiers = topology?.tiers as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tiers)) {
    for (const tier of tiers) {
      const tierName = tier.name as string | undefined;
      if (!tierName) continue;

      const tierServices = Array.isArray(tier.services) ? (tier.services as string[]) : [];
      const tierResourceRefs = Array.isArray(tier.resource_refs)
        ? (tier.resource_refs as string[])
        : [];
      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, `tier.${tierName}`),
        displayId: tierName,
        type: ENTITY_TYPE.DeploymentTier,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: tier.description as string | undefined,
        data: {
          ...tier,
          _tier_services: tierServices,
          _tier_resource_refs: tierResourceRefs,
          _resource_displayids: resourceDisplayIds,
        },
      });
    }
  }

  return entities;
}
