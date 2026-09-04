import { describe, it, expect } from 'vitest';
import { extractRg } from './rg.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';

const rgDoc: ParsedBlueprintDocument = {
  filePath: 'infrastructure.yaml',
  data: {
    version: '1.0.0',
    name: 'Test Infrastructure',
    resources: [
      {
        id: 'api-svc',
        kind: 'api',
        name: 'API Service',
        platform: { name: 'k8s', type: 'deployment' },
        owner: { team: 'TM001' },
      },
      {
        id: 'commerce-db',
        kind: 'database',
        name: 'Commerce DB',
        platform: { name: 'azure', type: 'postgres' },
        owner: { team: 'TM002' },
      },
    ],
    topology: {
      tiers: [
        {
          name: 'web-tier',
          description: 'Public-facing services',
          services: ['api-svc', 'public-storefront-service'],
          region: 'eu-west-1',
          replicas: 2,
        },
        {
          name: 'data-tier',
          description: 'Persistent storage layer',
          services: ['commerce-db'],
          region: 'eu-west-1',
        },
      ],
    },
  },
};

describe('extractRg', () => {
  it('extracts RG entities from each resource', () => {
    const entities = extractRg(rgDoc);
    const rg = entities.filter((e) => e.type === ENTITY_TYPE.RG);
    expect(rg.map((e) => e.displayId)).toEqual(['api-svc', 'commerce-db']);
  });

  it('extracts DeploymentTier entities from topology.tiers[]', () => {
    const entities = extractRg(rgDoc);
    const tiers = entities.filter((e) => e.type === ENTITY_TYPE.DeploymentTier);
    expect(tiers.map((e) => e.displayId)).toEqual(['web-tier', 'data-tier']);
  });

  it('attaches _tier_services and _resource_displayids on tier data for relation extraction', () => {
    const entities = extractRg(rgDoc);
    const webTier = entities.find(
      (e) => e.type === ENTITY_TYPE.DeploymentTier && e.displayId === 'web-tier',
    );

    expect(webTier?.data?._tier_services).toEqual(['api-svc', 'public-storefront-service']);
    expect(webTier?.data?._resource_displayids).toEqual(['api-svc', 'commerce-db']);
  });

  it('preserves resource owner.team field for ResourceOwnerTeam relation extraction', () => {
    const entities = extractRg(rgDoc);
    const apiSvc = entities.find(
      (e) => e.type === ENTITY_TYPE.RG && e.displayId === 'api-svc',
    );

    expect((apiSvc?.data as { owner: { team: string } }).owner.team).toBe('TM001');
  });

  it('assigns layer design.rg to all extracted entities', () => {
    const entities = extractRg(rgDoc);
    for (const e of entities) {
      expect(e.layer).toBe('design.rg');
    }
  });

  it('returns empty list when document has neither resources nor topology', () => {
    expect(extractRg({ filePath: 'empty.yaml', data: { version: '1.0.0' } })).toEqual([]);
  });

  it('extracts only resources when topology is absent', () => {
    const entities = extractRg({
      filePath: 'infrastructure.yaml',
      data: { resources: [{ id: 'a', kind: 'api', name: 'A' }] },
    });
    expect(entities.map((e) => e.type)).toEqual([ENTITY_TYPE.RG]);
  });

  it('extracts only tiers when resources is absent', () => {
    const entities = extractRg({
      filePath: 'infrastructure.yaml',
      data: { topology: { tiers: [{ name: 't1' }] } },
    });
    expect(entities.map((e) => e.type)).toEqual([ENTITY_TYPE.DeploymentTier]);
  });

  it('skips resources without an id', () => {
    const entities = extractRg({
      filePath: 'infrastructure.yaml',
      data: { resources: [{ id: 'a', kind: 'api' }, { kind: 'api' }] },
    });
    expect(entities.filter((e) => e.type === ENTITY_TYPE.RG)).toHaveLength(1);
  });

  it('skips tiers without a name', () => {
    const entities = extractRg({
      filePath: 'infrastructure.yaml',
      data: { topology: { tiers: [{ name: 't1' }, { description: 'unnamed' }] } },
    });
    expect(entities.filter((e) => e.type === ENTITY_TYPE.DeploymentTier)).toHaveLength(1);
  });
});
