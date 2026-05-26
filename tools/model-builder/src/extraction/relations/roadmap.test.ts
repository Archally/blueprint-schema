import { describe, it, expect } from 'vitest';
import { extractRoadmapRelations } from './roadmap.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function makeEntity(overrides: Partial<Entity> & { id: string; displayId: string; type: string }): Entity {
  return { layer: 'governance.roadmap', fileOrigin: 'roadmap.yaml', ...overrides };
}

describe('extractRoadmapRelations', () => {
  it('creates dependency relations between milestones', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'default-roadmap.yaml-MS002', displayId: 'MS002', type: ENTITY_TYPE.Milestone,
        data: { id: 'MS002', name: 'Beta', target_date: '2026-09-01', dependencies: ['MS001'] },
      }),
      makeEntity({ id: 'default-roadmap.yaml-MS001', displayId: 'MS001', type: ENTITY_TYPE.Milestone, data: { id: 'MS001' } }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractRoadmapRelations(entities, placeholders);
    const deps = relations.filter((r) => r.type === RELATION_TYPE.MilestoneDependency);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.source_entity_id).toBe('default-roadmap.yaml-MS002');
    expect(deps[0]!.target_entity_id).toBe('default-roadmap.yaml-MS001');
  });

  it('creates deliverable relations with kind predicate', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'default-roadmap.yaml-MS001', displayId: 'MS001', type: ENTITY_TYPE.Milestone,
        data: {
          id: 'MS001', name: 'MVP', target_date: '2026-06-01',
          deliverables: [
            { kind: 'capability', ref: 'CAP001' },
            { kind: 'user-story', ref: 'US001' },
            { kind: 'operation', ref: 'CMD001' },
          ],
        },
      }),
      makeEntity({ id: 'default-capability.yaml-CAP001', displayId: 'CAP001', type: ENTITY_TYPE.Capability, layer: 'governance.capability', fileOrigin: 'capability.yaml' }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractRoadmapRelations(entities, placeholders);
    const deliverables = relations.filter((r) => r.type === RELATION_TYPE.MilestoneDeliverable);
    expect(deliverables).toHaveLength(3);
    expect(deliverables[0]!.predicate).toBe('capability');
    expect(deliverables[1]!.predicate).toBe('user-story');
    // US001 and CMD001 not in entities → placeholders created
    expect(placeholders.size).toBe(2);
  });

  it('ignores non-Milestone entities', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'x', displayId: 'G001', type: ENTITY_TYPE.Goal, data: { dependencies: ['G002'] } }),
    ];
    const placeholders = new Map<string, Entity>();
    expect(extractRoadmapRelations(entities, placeholders)).toHaveLength(0);
  });

  it('handles milestone with no dependencies or deliverables', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'default-roadmap.yaml-MS001', displayId: 'MS001', type: ENTITY_TYPE.Milestone,
        data: { id: 'MS001', name: 'MVP', target_date: '2026-06-01' },
      }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractRoadmapRelations(entities, placeholders);
    expect(relations).toHaveLength(0);
  });
});
