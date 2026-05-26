import { describe, it, expect } from 'vitest';
import { extractCapabilityRelations } from './capability.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'governance.capability',
    fileOrigin: 'capability.yaml',
    ...overrides,
  };
}

const GOAL = makeEntity({
  id: 'default-motivation.yaml-G001',
  displayId: 'G001',
  type: ENTITY_TYPE.Goal,
  layer: 'governance.motivation',
  fileOrigin: 'motivation.yaml',
});

describe('extractCapabilityRelations — CapabilityGoal', () => {
  it('T03-A14: capability.goal_refs produce CapabilityGoal relations', () => {
    const capability = makeEntity({
      id: 'default-capability.yaml-CAP001',
      displayId: 'CAP001',
      type: ENTITY_TYPE.Capability,
      data: { id: 'CAP001', name: 'Order Management', goal_refs: ['G001'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractCapabilityRelations([capability, GOAL], placeholders);
    const goalRels = relations.filter((r) => r.type === RELATION_TYPE.CapabilityGoal);
    expect(goalRels).toHaveLength(1);
    expect(goalRels[0]!.source_entity_id).toBe(capability.id);
    expect(goalRels[0]!.target_entity_id).toBe(GOAL.id);
  });

  it('T03-A15: capability without goal_refs produces no CapabilityGoal', () => {
    const capability = makeEntity({
      id: 'default-capability.yaml-CAP002',
      displayId: 'CAP002',
      type: ENTITY_TYPE.Capability,
      data: { id: 'CAP002', name: 'Stock Reservation' },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractCapabilityRelations([capability], placeholders);
    expect(relations).toHaveLength(0);
  });
});
