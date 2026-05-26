import { describe, it, expect } from 'vitest';
import { extractRgRelations } from './rg.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function rgResource(displayId: string, ownerTeam?: string, fileOrigin = 'infrastructure.yaml'): Entity {
  return {
    id: `rg-${fileOrigin}-${displayId}`,
    displayId,
    type: ENTITY_TYPE.RG,
    layer: 'design.rg',
    fileOrigin,
    data: ownerTeam ? { owner: { team: ownerTeam } } : {},
  };
}

function deploymentTier(displayId: string, services: string[], fileOrigin = 'infrastructure.yaml'): Entity {
  return {
    id: `tier-${fileOrigin}-${displayId}`,
    displayId,
    type: ENTITY_TYPE.DeploymentTier,
    layer: 'design.rg',
    fileOrigin,
    data: { _tier_services: services, _resource_displayids: [] },
  };
}

function team(displayId: string): Entity {
  return {
    id: `team-${displayId}`,
    displayId,
    type: ENTITY_TYPE.Team,
    layer: 'governance.org',
    fileOrigin: 'organization.yaml',
  };
}

function service(displayId: string, fileOrigin = 'arch.yaml'): Entity {
  return {
    id: `svc-${fileOrigin}-${displayId}`,
    displayId,
    type: ENTITY_TYPE.Service,
    layer: 'design.arch',
    fileOrigin,
  };
}

describe('extractRgRelations', () => {
  it('emits Tier --contains--> Resource for each tier.services[] entry matching a same-file resource', () => {
    const entities: Entity[] = [
      rgResource('api-svc'),
      rgResource('commerce-db'),
      deploymentTier('web-tier', ['api-svc']),
      deploymentTier('data-tier', ['commerce-db']),
    ];

    const relations = extractRgRelations(entities);
    const contains = relations.filter((r) => r.type === RELATION_TYPE.Contains);

    expect(contains).toHaveLength(2);
    expect(contains.map((r) => `${r.source_entity_id}→${r.target_entity_id}`).sort()).toEqual([
      'tier-infrastructure.yaml-data-tier→rg-infrastructure.yaml-commerce-db',
      'tier-infrastructure.yaml-web-tier→rg-infrastructure.yaml-api-svc',
    ]);
  });

  it('emits Resource --owned-by-team--> Team when resource.owner.team matches a Team displayId', () => {
    const entities: Entity[] = [
      rgResource('api-svc', 'TM001'),
      rgResource('commerce-db', 'TM002'),
      team('TM001'),
      team('TM002'),
    ];

    const relations = extractRgRelations(entities);
    const ownedBy = relations.filter((r) => r.type === RELATION_TYPE.OwnedByTeam);

    expect(ownedBy).toHaveLength(2);
    expect(ownedBy.map((r) => r.target_entity_id).sort()).toEqual(['team-TM001', 'team-TM002']);
  });

  it('emits Service --deployed-in-tier--> Tier for cross-file arch service ids', () => {
    const entities: Entity[] = [
      deploymentTier('web-tier', ['public-storefront-service', 'api-svc']),
      rgResource('api-svc'), // also in this tier — covered by contains, not deployed-in
      service('public-storefront-service'),
    ];

    const relations = extractRgRelations(entities);
    const deployedIn = relations.filter((r) => r.type === RELATION_TYPE.DeployedInTier);

    expect(deployedIn).toHaveLength(1);
    expect(deployedIn[0]).toMatchObject({
      source_entity_id: 'svc-arch.yaml-public-storefront-service',
      target_entity_id: 'tier-infrastructure.yaml-web-tier',
      type: RELATION_TYPE.DeployedInTier,
    });
  });

  it('drops unresolvable team refs silently (no Missing placeholder)', () => {
    const entities: Entity[] = [rgResource('api-svc', 'TM999')];

    const relations = extractRgRelations(entities);
    expect(relations.filter((r) => r.type === RELATION_TYPE.OwnedByTeam)).toEqual([]);
  });

  it('drops unresolvable service refs in tier.services[] silently', () => {
    const entities: Entity[] = [deploymentTier('web-tier', ['nonexistent-service'])];

    const relations = extractRgRelations(entities);
    expect(relations).toEqual([]);
  });

  it('keeps tier→resource scoped per fileOrigin (no cross-file containment)', () => {
    const entities: Entity[] = [
      rgResource('api-svc', undefined, 'file-a.yaml'),
      deploymentTier('web-tier', ['api-svc'], 'file-b.yaml'),
    ];

    const relations = extractRgRelations(entities);
    expect(relations.filter((r) => r.type === RELATION_TYPE.Contains)).toEqual([]);
  });

  it('returns empty list when no rg entities present', () => {
    expect(extractRgRelations([team('TM001')])).toEqual([]);
  });
});
