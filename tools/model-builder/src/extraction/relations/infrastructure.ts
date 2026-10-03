import type { Entity, Relation } from '../../model/types.js';
import { indexDeclarations, resolveReference, type RefDeclaration, type RefIndex } from './refResolution.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Extract v2.7.7 infrastructure relations from the entity list.
 *
 * Emits (unresolvable targets are dropped silently — no Missing placeholders, mirroring
 * `extractRgRelations`; dangling typed refs are a validation-layer concern):
 *
 *   InfraResource --resource_owner_team-->  Team          (resource.owner.team, a free-string NAME)
 *   InfraResource --{hosted_on|connects_to|depends_on|attaches_to|routes_to}--> InfraResource
 *                                                          (resource.relations[], TOSCA; target
 *                                                           may be in another environment/substrate
 *                                                           for a hybrid network-link)
 *   InfraResource --realizes_type-->        ResourceType  (resource.type_ref)
 *   Binding       --binds-->                Environment   (binding.environment_ref)
 *   Binding       --binds-->                InfraResource (binding.resource_ref)
 *   Binding       --realizes_type-->        ResourceType  (binding.type_ref)
 *   Service       --needs-->                ResourceType  (service.needs[].type_ref, abstract intent)
 *   Service       --uses_resource-->        InfraResource (service.resource_refs[], concrete intent)
 *   Service       --deployed_in_environment-> Environment (service.servers[].environment, where the
 *                                                          server names one by id; a NAME builds no
 *                                                          edge - see the note below)
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
 *
 * WHICH MISSES GET A PLACEHOLDER, and why none of them are here. A placeholder exists for a target
 * the VALIDATOR cannot check: `archDependencies` builds one because a context dependency names a
 * context by NAME, and a name is not a reference the walk resolves. Everything this extractor reads
 * is a typed ref, so a miss is already a cross-reference error with a file and a location - a
 * placeholder would be the same fact told twice, in a vocabulary that reads like model content.
 * `servers[].environment` inherits the rule on both of its forms: as an `ENV###` it is a typed ref
 * the walk resolves, and as a name it is not a reference at all, so neither shape earns one.
 */

/**
 * The typed environment id, as `metamodel.schema.yaml#/$defs/environment_ref` states it. A server's
 * `environment` accepts this, a name from a small vocabulary, or an `x-` prefixed name, and only the
 * first is a reference: matching here is what tells the three apart.
 */
const ENVIRONMENT_ID = /^([a-z][a-z0-9-]*\.)?ENV\d{3,}$/;

const TOSCA_RELATION: Record<string, string> = {
  hosted_on: RELATION_TYPE.HostedOn,
  connects_to: RELATION_TYPE.ConnectsTo,
  depends_on: RELATION_TYPE.DependsOn,
  attaches_to: RELATION_TYPE.AttachesTo,
  routes_to: RELATION_TYPE.RoutesTo,
};

/** Entities of one type, indexed by the id string each was declared with. */
class EntitiesById {
  private readonly declarations: RefDeclaration[] = [];
  private readonly byHandle = new Map<string, Entity>();
  private index: RefIndex | null = null;

  add(entity: Entity): void {
    this.declarations.push({ id: entity.displayId, handle: entity.id });
    this.byHandle.set(entity.id, entity);
    this.index = null;
  }

  /** The one entity declared with exactly this string; none when no entity or several do. */
  resolve(ref: string): Entity | undefined {
    this.index ??= indexDeclarations(this.declarations);
    const resolution = resolveReference(this.index, ref);
    return resolution.status === 'resolved' ? this.byHandle.get(resolution.handle) : undefined;
  }
}

/**
 * Match a typed ref by the shared resolution function. A scope prefix is part of the id, so
 * `platform.IR001` does not match an `IR001`, and a string several entities declare matches none.
 */
function resolveByRef(index: EntitiesById, ref: string): Entity | undefined {
  return index.resolve(ref);
}

export function extractInfrastructureRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  const teamByDisplayId = new EntitiesById();
  const serviceByDisplayId = new EntitiesById();
  const infraByDisplayId = new EntitiesById();
  const envByDisplayId = new EntitiesById();
  const resourceTypeByDisplayId = new EntitiesById();
  const scopeByDisplayId = new EntitiesById();
  const infraByFileAndDisplayId = new Map<string, Map<string, Entity>>();

  for (const e of entities) {
    switch (e.type) {
      case ENTITY_TYPE.Team:
        teamByDisplayId.add(e);
        break;
      case ENTITY_TYPE.Service:
        serviceByDisplayId.add(e);
        break;
      case ENTITY_TYPE.Environment:
        envByDisplayId.add(e);
        break;
      case ENTITY_TYPE.ResourceType:
        resourceTypeByDisplayId.add(e);
        break;
      case ENTITY_TYPE.DeploymentScope:
        scopeByDisplayId.add(e);
        break;
      case ENTITY_TYPE.InfraResource: {
        infraByDisplayId.add(e);
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
        const team = teamByDisplayId.resolve(teamRef);
        if (team) push(e, RELATION_TYPE.ResourceOwnerTeam, team);
      }

      // relations[] → TOSCA edges (target may cross environments/substrates)
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
      // servers[].environment → Environment, for the typed form only. Two servers of one service in
      // the same environment are one edge: the pair is the fact, and a relation id is built from it.
      const servers = data.servers as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(servers)) {
        const emitted = new Set<string>();
        for (const server of servers) {
          const value = server?.environment;
          if (typeof value !== 'string' || !ENVIRONMENT_ID.test(value)) continue;
          const env = resolveByRef(envByDisplayId, value);
          if (!env || emitted.has(env.id)) continue;
          emitted.add(env.id);
          push(e, RELATION_TYPE.DeployedInEnvironment, env);
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
          const service = serviceByDisplayId.resolve(ref);
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
