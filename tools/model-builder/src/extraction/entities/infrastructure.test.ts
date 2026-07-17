import { describe, it, expect } from 'vitest';
import { extractInfrastructure } from './infrastructure.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';

function doc(data: Record<string, unknown>, filePath = 'infrastructure.yaml'): ParsedBlueprintDocument {
  return { data, filePath, scope: undefined };
}

describe('extractInfrastructure', () => {
  it('emits InfraResource entities (IR###) in layer design.infrastructure', () => {
    const entities = extractInfrastructure(
      doc({
        version: '1.0.0',
        resources: [
          { id: 'IR001', kind: 'database', name: 'Orders DB' },
          { id: 'IR002', kind: 'cache', name: 'Session Cache' },
        ],
      }),
    );
    const infra = entities.filter((e) => e.type === ENTITY_TYPE.InfraResource);
    expect(infra).toHaveLength(2);
    expect(infra[0]).toMatchObject({
      displayId: 'IR001',
      type: ENTITY_TYPE.InfraResource,
      layer: 'design.infrastructure',
    });
  });

  it('emits Environment entities only for the object form (string env names are skipped)', () => {
    const entities = extractInfrastructure(
      doc({
        version: '1.0.0',
        environments: [
          'dev',
          { id: 'ENV001', name: 'production', substrate: 'cloud' },
        ],
      }),
    );
    const envs = entities.filter((e) => e.type === ENTITY_TYPE.Environment);
    expect(envs).toHaveLength(1);
    expect(envs[0]).toMatchObject({ displayId: 'ENV001', summary: 'production' });
  });

  it('emits Binding entities (BND###)', () => {
    const entities = extractInfrastructure(
      doc({
        version: '1.0.0',
        bindings: [{ id: 'BND001', type_ref: 'RT001', environment_ref: 'ENV001' }],
      }),
    );
    const bindings = entities.filter((e) => e.type === ENTITY_TYPE.Binding);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ displayId: 'BND001', layer: 'design.infrastructure' });
  });

  it('emits DeploymentScope entities (DSC###) from deployment_scopes[]', () => {
    const entities = extractInfrastructure(
      doc({
        version: '1.0.0',
        deployment_scopes: [
          { id: 'DSC001', name: 'prod', kind: 'subscription', substrate: 'cloud' },
          { id: 'DSC002', name: 'Accounting', kind: 'resource_group', parent: 'DSC001' },
        ],
      }),
    );
    const scopes = entities.filter((e) => e.type === ENTITY_TYPE.DeploymentScope);
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toMatchObject({
      displayId: 'DSC001',
      summary: 'prod',
      layer: 'design.infrastructure',
    });
    expect(scopes[1].data).toMatchObject({ kind: 'resource_group', parent: 'DSC001' });
  });

  it('emits DeploymentTier carrying legacy services + typed resource_refs', () => {
    const entities = extractInfrastructure(
      doc({
        version: '1.0.0',
        resources: [{ id: 'IR001', kind: 'database', name: 'DB' }],
        topology: { tiers: [{ name: 'data-tier', services: ['legacy-db'], resource_refs: ['IR001'] }] },
      }),
    );
    const tier = entities.find((e) => e.type === ENTITY_TYPE.DeploymentTier);
    expect(tier).toBeDefined();
    expect(tier!.layer).toBe('design.infrastructure');
    expect(tier!.data).toMatchObject({
      _tier_services: ['legacy-db'],
      _tier_resource_refs: ['IR001'],
      _resource_displayids: ['IR001'],
    });
  });

  it('skips resources / environments / bindings / deployment_scopes without an id', () => {
    const entities = extractInfrastructure(
      doc({
        version: '1.0.0',
        resources: [{ kind: 'database', name: 'no-id' }],
        environments: [{ name: 'no-id-env' }],
        bindings: [{ type_ref: 'RT001' }],
        deployment_scopes: [{ name: 'no-id-scope', kind: 'resource_group' }],
      }),
    );
    expect(entities).toHaveLength(0);
  });
});
