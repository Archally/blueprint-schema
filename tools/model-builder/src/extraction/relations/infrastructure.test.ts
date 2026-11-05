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
  return { id: `team-${displayId}`, displayId, type: ENTITY_TYPE.Team, layer: 'governance.org', fileOrigin: 'org.yaml' };
}
function scope(displayId: string, data: Record<string, unknown> = {}, fileOrigin = FILE): Entity {
  return { id: `scope-${fileOrigin}-${displayId}`, displayId, type: ENTITY_TYPE.DeploymentScope, layer: 'design.infrastructure', fileOrigin, data };
}
function contract(displayId: string, data: Record<string, unknown>): Entity {
  return { id: `contract-arch.yaml-${displayId}`, displayId, type: ENTITY_TYPE.Contract, layer: 'design.arch', fileOrigin: 'arch.yaml', data };
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

  it('resolves a TOSCA target by its exact id, and not across a scope prefix (prod.IR030 is not IR030)', () => {
    const rels = extractInfrastructureRelations([
      infra('IR050', { hosting_model: 'network-link', relations: [{ type: 'routes_to', target: 'prod.IR030' }] }),
      infra('IR051', { hosting_model: 'network-link', relations: [{ type: 'routes_to', target: 'IR030' }] }),
      infra('IR030'),
    ]);
    const routes = rels.filter((r) => r.type === RELATION_TYPE.RoutesTo);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.source_entity_id).toContain('IR051');
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

  it('emits Service --deployed_in_environment--> Environment for the typed form, and only for it', () => {
    // Four servers, one edge. The name and the `x-` escape are not references and resolve to
    // nothing; the dangling id IS a reference and is reported by the validator, so it is dropped
    // here rather than told twice. All four in one model, since passing on one says nothing.
    const rels = extractInfrastructureRelations([
      service('SVC001', { servers: [
        { url: 'https://a', environment: 'ENV001' },
        { url: 'https://b', environment: 'production' },
        { url: 'https://c', environment: 'x-edge' },
        { url: 'https://d', environment: 'ENV404' },
      ] }),
      environment('ENV001'),
    ]);
    const deployed = rels.filter((r) => r.type === RELATION_TYPE.DeployedInEnvironment);
    expect(deployed).toHaveLength(1);
    expect(deployed[0]).toMatchObject({
      source_entity_id: 'svc-arch.yaml-SVC001',
      target_entity_id: 'p-infrastructure.yaml-ENV001',
    });
  });

  it('two servers in one environment are one edge, and a scope prefix is part of the environment id', () => {
    const rels = extractInfrastructureRelations([
      service('SVC001', { servers: [
        { url: 'https://a', environment: 'ENV001' },
        { url: 'https://b', environment: 'ENV001' },
      ] }),
      service('SVC002', { servers: [{ url: 'https://c', environment: 'shop.ENV001' }] }),
      environment('ENV001'),
    ]);
    const deployed = rels.filter((r) => r.type === RELATION_TYPE.DeployedInEnvironment);
    expect(deployed).toHaveLength(1);
    expect(deployed[0]!.source_entity_id).toContain('SVC001');
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

  it('emits Contract --contract_broker--> InfraResource from a messaging contract\'s broker_ref', () => {
    const rels = extractInfrastructureRelations([
      contract('order-api.asyncapi', { _contractType: 'asyncapi', broker_ref: 'IR006' }),
      infra('IR006', { kind: 'broker' }),
      infra('IR007', { kind: 'cache' }),
    ]);
    const brokers = rels.filter((r) => r.type === RELATION_TYPE.ContractBroker);
    expect(brokers.map((r) => [r.source_entity_id, r.target_entity_id])).toEqual([
      ['contract-arch.yaml-order-api.asyncapi', 'p-infrastructure.yaml-IR006'],
    ]);
  });

  it('builds no contract_broker edge from the superseded brokerId, nor from a broker_ref nothing declares', () => {
    const rels = extractInfrastructureRelations([
      contract('order-api.asyncapi', { _contractType: 'asyncapi', brokerId: 'IR006' }),
      contract('stock-api.asyncapi', { _contractType: 'asyncapi', broker_ref: 'IR009' }),
      infra('IR006', { kind: 'broker' }),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.ContractBroker)).toEqual([]);
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

  it('emits InfraResource --resource_owner_team--> Team', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { owner: { team: 'TM001' } }),
      team('TM001'),
    ]);
    expect(rels.filter((r) => r.type === RELATION_TYPE.ResourceOwnerTeam)).toHaveLength(1);
  });

  it('drops unresolvable TOSCA targets silently (no placeholders)', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { relations: [{ type: 'hosted_on', target: 'IR999' }] }),
    ]);
    expect(rels).toEqual([]);
  });

  it('emits grouped_in from resource.scope_ref - the RG-vs-pool case: same resource is BOTH grouped_in + hosted_on', () => {
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

  it('resolves a scope_ref by its exact id, and not across a scope prefix (shared.DSC001 is not DSC001)', () => {
    const rels = extractInfrastructureRelations([
      infra('IR001', { scope_ref: 'shared.DSC001' }),
      infra('IR002', { scope_ref: 'DSC001' }),
      scope('DSC001'),
    ]);
    const grouped = rels.filter((r) => r.type === RELATION_TYPE.GroupedIn);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.source_entity_id).toContain('IR002');
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
