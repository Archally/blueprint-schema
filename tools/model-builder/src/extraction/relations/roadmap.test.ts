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

  // ── v2.7.2 work items ──

  it('creates work item → milestone roll-up relations', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'default-roadmap.yaml-WI001', displayId: 'WI001', type: ENTITY_TYPE.WorkItem, data: { id: 'WI001', milestone: 'MS001' } }),
      makeEntity({ id: 'default-roadmap.yaml-MS001', displayId: 'MS001', type: ENTITY_TYPE.Milestone, data: { id: 'MS001' } }),
    ];
    const roll = extractRoadmapRelations(entities, new Map()).filter((r) => r.type === RELATION_TYPE.WorkItemMilestone);
    expect(roll).toHaveLength(1);
    expect(roll[0]!.source_entity_id).toBe('default-roadmap.yaml-WI001');
    expect(roll[0]!.target_entity_id).toBe('default-roadmap.yaml-MS001');
  });

  it('creates parent → child hierarchy relations', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'default-roadmap.yaml-WI001', displayId: 'WI001', type: ENTITY_TYPE.WorkItem, data: { id: 'WI001', children: [{ id: 'WI002' }, { id: 'WI003' }] } }),
      makeEntity({ id: 'default-roadmap.yaml-WI002', displayId: 'WI002', type: ENTITY_TYPE.WorkItem, data: { id: 'WI002' } }),
      makeEntity({ id: 'default-roadmap.yaml-WI003', displayId: 'WI003', type: ENTITY_TYPE.WorkItem, data: { id: 'WI003' } }),
    ];
    const kids = extractRoadmapRelations(entities, new Map()).filter((r) => r.type === RELATION_TYPE.WorkItemChild);
    expect(kids.map((r) => r.target_entity_id)).toEqual(['default-roadmap.yaml-WI002', 'default-roadmap.yaml-WI003']);
    expect(kids[0]!.source_entity_id).toBe('default-roadmap.yaml-WI001');
  });

  it('creates depends_on and blocked_by relations (string blockers ignored)', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'default-roadmap.yaml-WI002', displayId: 'WI002', type: ENTITY_TYPE.WorkItem,
        data: { id: 'WI002', depends_on: ['WI001', 'MS001'], blockers: ['plain caption', { text: 'blocked', blocked_by: ['INQ001'] }] },
      }),
      makeEntity({ id: 'default-roadmap.yaml-WI001', displayId: 'WI001', type: ENTITY_TYPE.WorkItem, data: { id: 'WI001' } }),
    ];
    const relations = extractRoadmapRelations(entities, new Map());
    expect(relations.filter((r) => r.type === RELATION_TYPE.WorkItemDependency)).toHaveLength(2); // WI001 resolved + MS001 placeholder
    const blocked = relations.filter((r) => r.type === RELATION_TYPE.WorkItemBlockedBy);
    expect(blocked).toHaveLength(1); // only the object-form blocker with blocked_by[]
    expect(blocked[0]!.target_entity_id).toBe('missing-INQ001');
  });

  it('creates typed relations on both milestone and work_item tiers', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'default-roadmap.yaml-MS001', displayId: 'MS001', type: ENTITY_TYPE.Milestone, data: { id: 'MS001', advances_goals: ['G001'], value_streams: ['VS001'] } }),
      makeEntity({ id: 'default-roadmap.yaml-WI001', displayId: 'WI001', type: ENTITY_TYPE.WorkItem, data: { id: 'WI001', realizes_decisions: ['D001'], user_stories: ['US001'], use_cases: ['UC001'] } }),
    ];
    const rels = extractRoadmapRelations(entities, new Map());
    expect(rels.filter((r) => r.type === RELATION_TYPE.RoadmapAdvancesGoal)).toHaveLength(1);
    expect(rels.filter((r) => r.type === RELATION_TYPE.RoadmapValueStream)).toHaveLength(1);
    expect(rels.filter((r) => r.type === RELATION_TYPE.RoadmapRealizesDecision)).toHaveLength(1);
    expect(rels.filter((r) => r.type === RELATION_TYPE.RoadmapUserStory)).toHaveLength(1);
    expect(rels.filter((r) => r.type === RELATION_TYPE.RoadmapUseCase)).toHaveLength(1);
    expect(rels.find((r) => r.type === RELATION_TYPE.RoadmapAdvancesGoal)!.source_entity_id).toBe('default-roadmap.yaml-MS001');
    expect(rels.find((r) => r.type === RELATION_TYPE.RoadmapRealizesDecision)!.source_entity_id).toBe('default-roadmap.yaml-WI001');
  });
});
