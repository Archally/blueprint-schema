import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Extract v2.7.7 infrastructure relations from the entity list.
 *
 * Emits (unresolvable targets are dropped silently — no Missing placeholders, mirroring
 * `extractRgRelations`; dangling typed refs are a validation-layer concern):
 *
 *   InfraResource --owned_by_team-->        Team          (resource.owner.team)
 *   InfraResource --{hosted_on|connects_to|depends_on|attaches_to|routes_to}--> InfraResource
 *                                                          (resource.relations[], TOSCA; target
 *                                                           may be in another environment/substrate
 *                                                           for a hybrid network-link, RD31)
 *   InfraResource --realizes_type-->        ResourceType  (resource.type_ref)
 *   Binding       --binds-->                Environment   (binding.environment_ref)
 *   Binding       --binds-->                InfraResource (binding.resource_ref)
 *   Binding       --realizes_type-->        ResourceType  (binding.type_ref)
 *   Service       --needs-->                ResourceType  (service.needs[].type_ref, abstract intent)
 *   Service       --uses_resource-->        InfraResource (service.resource_refs[], concrete intent)
 *   DeploymentTier--contains-->             InfraResource (tier.resource_refs[] typed + legacy
 *                                                          tier.services[] same-file matches)
 *   Service       --deployed_in_tier-->     DeploymentTier(legacy tier.services[] cross-file service)
 *   InfraResource --grouped_in-->           DeploymentScope(resource.scope_ref — management grouping,
 *                                                          the NON-TOSCA counterpart to hosted_on
 *                                                          placement; a resource can be both, SD2/SD4)
 *   DeploymentScope--nested_in-->           DeploymentScope(scope.parent — subscription→resource-group)
 *   Environment   --targets_scope-->        DeploymentScope(environment.target_scope.ref, promoted inline)
 *
 * `hosted_on` (InfraResource→InfraResource) is the canonical PLACEMENT edge; `contains`
 * (DeploymentTier→InfraResource) is a grouping VIEW — distinct types, so a resource that is
 * both `hosted_on` a host and listed in a tier is never double-counted (G8).
 *
 * ResourceType (RT###) entities are catalog-sourced (profile files, not project models); until
 * profiles load through core, `needs`/`realizes_type` targeting RT### resolve to nothing and are
 * dropped. The edge logic is ready and lights up automatically once RT entities exist.
 */

const TOSCA_RELATION: Record<string, string> = {
  hosted_on: RELATION_TYPE.HostedOn,
  connects_to: RELATION_TYPE.ConnectsTo,
  depends_on: RELATION_TYPE.DependsOn,
  attaches_to: RELATION_TYPE.AttachesTo,
  routes_to: RELATION_TYPE.RoutesTo,
};

/** Match a typed ref against an index by exact displayId, then by stripping one `scope.` prefix. */
function resolveByRef(index: Map<string, Entity>, ref: string): Entity | undefined {
  const exact = index.get(ref);
  if (exact) return exact;
  const dot = ref.indexOf('.');
  if (dot > 0) return index.get(ref.slice(dot + 1));
  return undefined;
}

export function extractInfrastructureRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  const teamByDisplayId = new Map<string, Entity>();
  const serviceByDisplayId = new Map<string, Entity>();
  const infraByDisplayId = new Map<string, Entity>();
  const envByDisplayId = new Map<string, Entity>();
  const resourceTypeByDisplayId = new Map<string, Entity>();
  const scopeByDisplayId = new Map<string, Entity>();
  const infraByFileAndDisplayId = new Map<string, Map<string, Entity>>();

  for (const e of entities) {
    switch (e.type) {
      case ENTITY_TYPE.Team:
        if (!teamByDisplayId.has(e.displayId)) teamByDisplayId.set(e.displayId, e);
        break;
      case ENTITY_TYPE.Service:
        if (!serviceByDisplayId.has(e.displayId)) serviceByDisplayId.set(e.displayId, e);
        break;
      case ENTITY_TYPE.Environment:
        if (!envByDisplayId.has(e.displayId)) envByDisplayId.set(e.displayId, e);
        break;
      case ENTITY_TYPE.ResourceType:
        if (!resourceTypeByDisplayId.has(e.displayId)) resourceTypeByDisplayId.set(e.displayId, e);
        break;
      case ENTITY_TYPE.DeploymentScope:
        if (!scopeByDisplayId.has(e.displayId)) scopeByDisplayId.set(e.displayId, e);
        break;
      case ENTITY_TYPE.InfraResource: {
        if (!infraByDisplayId.has(e.displayId)) infraByDisplayId.set(e.displayId, e);
        const file = e.fileOrigin ?? '';
        if (!infraByFileAndDisplayId.has(file)) infraByFileAndDisplayId.set(file, new Map());
        infraByFileAndDisplayId.get(file)!.set(e.displayId, e);
        break;
      }
    }
  }

  const push = (source: Entity, type: string, target: Entity, data?: Record<string, unknown>) => {
    relations.push({
      id: `${source.id}--${type}--${target.id}`,
      source_entity_id: source.id,
      target_entity_id: target.id,
      type,
      ...(data ? { data } : {}),
    });
  };

  for (const e of entities) {
    const data = (e.data as Record<string, unknown> | undefined) ?? {};

    if (e.type === ENTITY_TYPE.InfraResource) {
      // owner.team → Team
      const owner = data.owner as Record<string, unknown> | undefined;
      const teamRef = owner?.team as string | undefined;
      if (teamRef) {
        const team = teamByDisplayId.get(teamRef);
        if (team) push(e, RELATION_TYPE.OwnedByTeam, team);
      }

      // relations[] → TOSCA edges (target may cross environments/substrates, RD31)
      const rels = data.relations as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(rels)) {
        for (const rel of rels) {
          const relType = TOSCA_RELATION[rel.type as string];
          const targetRef = rel.target as string | undefined;
          if (!relType || !targetRef) continue;
          const target = resolveByRef(infraByDisplayId, targetRef);
          if (target) {
            const outputs = rel.outputs;
            push(e, relType, target, Array.isArray(outputs) ? { outputs } : undefined);
          }
        }
      }

      // type_ref → ResourceType
      const typeRef = data.type_ref as string | undefined;
      if (typeRef) {
        const rt = resolveByRef(resourceTypeByDisplayId, typeRef);
        if (rt) push(e, RELATION_TYPE.RealizesType, rt);
      }

      // scope_ref → DeploymentScope (management grouping; distinct from hosted_on placement, SD2)
      const scopeRef = data.scope_ref as string | undefined;
      if (scopeRef) {
        const scope = resolveByRef(scopeByDisplayId, scopeRef);
        if (scope) push(e, RELATION_TYPE.GroupedIn, scope);
      }
    }

    if (e.type === ENTITY_TYPE.DeploymentScope) {
      // parent → DeploymentScope (the subscription→resource-group hierarchy)
      const parentRef = data.parent as string | undefined;
      if (parentRef) {
        const parent = resolveByRef(scopeByDisplayId, parentRef);
        if (parent) push(e, RELATION_TYPE.NestedIn, parent);
      }
    }

    if (e.type === ENTITY_TYPE.Environment) {
      // target_scope.ref → DeploymentScope (promoted inline scope, additive)
      const targetScope = data.target_scope as Record<string, unknown> | undefined;
      const scopeRef = targetScope?.ref as string | undefined;
      if (scopeRef) {
        const scope = resolveByRef(scopeByDisplayId, scopeRef);
        if (scope) push(e, RELATION_TYPE.TargetsScope, scope);
      }
    }

    if (e.type === ENTITY_TYPE.Binding) {
      const envRef = data.environment_ref as string | undefined;
      if (envRef) {
        const env = resolveByRef(envByDisplayId, envRef);
        if (env) push(e, RELATION_TYPE.Binds, env);
      }
      const resourceRef = data.resource_ref as string | undefined;
      if (resourceRef) {
        const resource = resolveByRef(infraByDisplayId, resourceRef);
        if (resource) push(e, RELATION_TYPE.Binds, resource);
      }
      const typeRef = data.type_ref as string | undefined;
      if (typeRef) {
        const rt = resolveByRef(resourceTypeByDisplayId, typeRef);
        if (rt) push(e, RELATION_TYPE.RealizesType, rt);
      }
    }

    if (e.type === ENTITY_TYPE.Service) {
      // needs[].type_ref → ResourceType (abstract intent)
      const needs = data.needs as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(needs)) {
        for (const need of needs) {
          const typeRef = need.type_ref as string | undefined;
          if (!typeRef) continue;
          const rt = resolveByRef(resourceTypeByDisplayId, typeRef);
          if (rt) push(e, RELATION_TYPE.Needs, rt);
        }
      }
      // resource_refs[] → InfraResource (concrete intent)
      const resourceRefs = data.resource_refs as string[] | undefined;
      if (Array.isArray(resourceRefs)) {
        for (const ref of resourceRefs) {
          const resource = resolveByRef(infraByDisplayId, ref);
          if (resource) push(e, RELATION_TYPE.UsesResource, resource);
        }
      }
    }

    if (e.type === ENTITY_TYPE.DeploymentTier && e.layer === 'design.infrastructure') {
      const tierFile = e.fileOrigin ?? '';
      const localResources = infraByFileAndDisplayId.get(tierFile) ?? new Map<string, Entity>();

      // typed resource_refs → contains (global by displayId)
      const typedRefs = data._tier_resource_refs as string[] | undefined;
      if (Array.isArray(typedRefs)) {
        for (const ref of typedRefs) {
          const resource = resolveByRef(infraByDisplayId, ref);
          if (resource) push(e, RELATION_TYPE.Contains, resource);
        }
      }

      // legacy services[] → contains (same-file resource) OR service deployed_in_tier (cross-file)
      const services = data._tier_services as string[] | undefined;
      if (Array.isArray(services)) {
        for (const ref of services) {
          const resource = localResources.get(ref);
          if (resource) {
            push(e, RELATION_TYPE.Contains, resource);
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
  }

  return relations;
}
