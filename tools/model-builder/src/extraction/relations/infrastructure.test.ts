import { describe, it, expect } from 'vitest';
import { extractInfrastructureRelations } from './infrastructure.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

const FILE = 'infrastructure.yaml';

function infra(displayId: string, data: Record<string, unknown> = {}, fileOrigin = FILE): Entity {
  return {
    id: `p-${fileOrigin}-${displayId}`,
    displayId,
    type: ENTITY_TYPE.InfraResource,
    layer: 'design.infrastructure',
    fileOrigin,
    data,
  };
}
function environment(displayId: string): Entity {
  return { id: `p-${FILE}-${displayId}`, displayId, type: ENTITY_TYPE.Environment, layer: 'design.infrastructure', fileOrigin: FILE };
}
function binding(displayId: string, data: Record<string, unknown>): Entity {
  return { id: `p-${FILE}-${displayId}`, displayId, type: ENTITY_TYPE.Binding, layer: 'design.infrastructure', fileOrigin: FILE, data };
}
function resourceType(displayId: string): Entity {
  return { id: `rt-${displayId}`, displayId, type: ENTITY_TYPE.ResourceType, layer: 'design.infrastructure', fileOrigin: 'neutral.yaml' };
}
function tier(displayId: string, data: Record<string, unknown>, fileOrigin = FILE): Entity {
  return { id: `tier-${fileOrigin}-${displayId}`, displayId, type: ENTITY_TYPE.DeploymentTier, layer: 'design.infrastructure', fileOrigin, data };
}
function service(displayId: string, data: Record<string, unknown> = {}): Entity {
  return { id: `svc-arch.yaml-${displayId}`, displayId, type: ENTITY_TYPE.Service, layer: 'design.arch', fileOrigin: 'arch.yaml', data };
}
function team(displayId: string): Entity {
  return { id: `team-${displayId}`, displayId, type: ENTITY_TYPE.Team, layer: 'governance.org', fileOrigin: 'organization.yaml' };
}
function scope(displayId: string, data: Record<string, unknown> = {}, fileOrigin = FILE): Entity {
  return { id: `scope-${fileOrigin}-${displayId}`, displayId, type: ENTITY_TYPE.DeploymentScope, layer: 'design.infrastructure', fileOrigin, data };
}
function environmentWith(displayId: string, data: Record<string, unknown>): Entity {
  return { id: `p-${FILE}-${displayId}`, displayId, type: ENTITY_TYPE.Environment, layer: 'design.infrastructure', fileOrigin: FILE, data };
}

describe('extractInfrastructureRelations', () => {
  it('emits TOSCA edges from resource.relations[] with distinct types', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { relations: [
        { type: 'hosted_on', target: 'IR010' },
        { type: 'connects_to', target: 'IR020', outputs: ['host', 'port'] },
      ] }),
      infra('IR010'),
      infra('IR020'),
    ]);
    const hosted = rels.find((r) => r.type === RELATION_TYPE.HostedOn);
    const connects = rels.find((r) => r.type === RELATION_TYPE.ConnectsTo);
    expect(hosted).toMatchObject({ source_entity_id: 'p-infrastructure.yaml-IR001', target_entity_id: 'p-infrastructure.yaml-IR010' });
    expect(connects?.data).toEqual({ outputs: ['host', 'port'] });
  });

  it('resolves a TOSCA target across a scope prefix (prod.IR030 → IR030)', () => {
    const rels = extractInfrastructureRelations([
      infra('IR050', { hosting_model: 'network-link', relations: [{ type: 'routes_to', target: 'prod.IR030' }] }),
      infra('IR030'),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.RoutesTo)).toHaveLength(1);
  });

  it('emits Binding --binds--> Environment and InfraResource; realizes_type to RT', () => {
    const rels = extractInfrastructureRelations([
      binding('BND001', { type_ref: 'RT001', environment_ref: 'ENV001', resource_ref: 'IR001' }),
      environment('ENV001'),
      infra('IR001'),
      resourceType('RT001'),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.Binds)).toHaveLength(2);
    expect(rels.filter((r) => r.type === RELATION_TYPE.RealizesType)).toHaveLength(1);
  });

  it('emits Service --needs--> ResourceType and --uses_resource--> InfraResource', () => {
    const rels = extractInfrastructureRelations([
      service('order-api', { needs: [{ type_ref: 'RT001' }], resource_refs: ['IR001'] }),
      resourceType('RT001'),
      infra('IR001'),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.Needs)).toHaveLength(1);
    expect(rels.filter((r) => r.type === RELATION_TYPE.UsesResource)).toHaveLength(1);
  });

  it('drops needs/realizes_type when the ResourceType catalog is absent (no profiles loaded)', () => {
    const rels = extractInfrastructureRelations([
      service('order-api', { needs: [{ type_ref: 'RT999' }] }),
      infra('IR001', { type_ref: 'RT999' }),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.Needs)).toEqual([]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.RealizesType)).toEqual([]);
  });

  it('tier resource_refs (typed) + same-file services (legacy) both become contains', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001'),
      infra('legacy-db'),
      tier('data-tier', { _tier_resource_refs: ['IR001'], _tier_services: ['legacy-db'], _resource_displayids: ['IR001', 'legacy-db'] }),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.Contains)).toHaveLength(2);
  });

  it('tier legacy services matching a cross-file arch service become deployed_in_tier', () => {
    const rels = extractInfrastructureRelations([
      service('storefront'),
      tier('web-tier', { _tier_services: ['storefront'], _tier_resource_refs: [], _resource_displayids: [] }),
    ]);
    const deployed = rels.filter((r) => r.type === RELATION_TYPE.DeployedInTier);
    expect(deployed).toHaveLength(1);
    expect(deployed[0]).toMatchObject({ source_entity_id: 'svc-arch.yaml-storefront', target_entity_id: 'tier-infrastructure.yaml-web-tier' });
  });

  it('emits InfraResource --owned_by_team--> Team', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { owner: { team: 'TM001' } }),
      team('TM001'),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.OwnedByTeam)).toHaveLength(1);
  });

  it('drops unresolvable TOSCA targets silently (no placeholders)', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { relations: [{ type: 'hosted_on', target: 'IR999' }] }),
    ]);
    expect(rels).toEqual([]);
  });

  it('emits grouped_in from resource.scope_ref — the resource-group-vs-pool case: same resource is BOTH grouped_in + hosted_on', () => {
    const rels = extractInfrastructureRelations([
      infra('IR004', { scope_ref: 'DSC002', relations: [{ type: 'hosted_on', target: 'IR002' }] }),
      infra('IR002'),
      scope('DSC002'),
    ]);
    const grouped = rels.filter((r) => r.type === RELATION_TYPE.GroupedIn);
    const hosted = rels.filter((r) => r.type === RELATION_TYPE.HostedOn);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      source_entity_id: 'p-infrastructure.yaml-IR004',
      target_entity_id: 'scope-infrastructure.yaml-DSC002',
    });
    expect(hosted).toHaveLength(1); // management grouping and runtime placement coexist
  });

  it('resolves a scope_ref across a scope prefix (shared.DSC001 → DSC001)', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { scope_ref: 'shared.DSC001' }),
      scope('DSC001'),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.GroupedIn)).toHaveLength(1);
  });

  it('emits nested_in from scope.parent (subscription→resource-group hierarchy)', () => {
    const rels = extractInfrastructureRelations([
      scope('DSC001'),
      scope('DSC002', { parent: 'DSC001' }),
    ]);
    const nested = rels.filter((r) => r.type === RELATION_TYPE.NestedIn);
    expect(nested).toHaveLength(1);
    expect(nested[0]).toMatchObject({
      source_entity_id: 'scope-infrastructure.yaml-DSC002',
      target_entity_id: 'scope-infrastructure.yaml-DSC001',
    });
  });

  it('emits targets_scope from environment.target_scope.ref; inline {kind,name} emits nothing', () => {
    const rels = extractInfrastructureRelations([
      environmentWith('ENV001', { target_scope: { kind: 'subscription', name: 'prod-sub' } }),
      environmentWith('ENV002', { target_scope: { ref: 'DSC001' } }),
      scope('DSC001'),
    ]);
    const targets = rels.filter((r) => r.type === RELATION_TYPE.TargetsScope);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      source_entity_id: 'p-infrastructure.yaml-ENV002',
      target_entity_id: 'scope-infrastructure.yaml-DSC001',
    });
  });

  it('drops grouped_in / nested_in when the scope target is unresolved (no placeholders)', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { scope_ref: 'DSC999' }),
      scope('DSC002', { parent: 'DSC999' }),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.GroupedIn)).toHaveLength(0);
    expect(rels.filter((r) => r.type === RELATION_TYPE.NestedIn)).toHaveLength(0);
  });
});
