import { describe, it, expect } from 'vitest';
import { extractDecisionRelations } from './decisions.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'governance.decisions',
    fileOrigin: 'decisions.yaml',
    ...overrides,
  };
}

const INQUIRY = makeEntity({
  id: 'motivation.yaml-INQ001',
  displayId: 'INQ001',
  type: ENTITY_TYPE.Inquiry,
  layer: 'governance.motivation',
  fileOrigin: 'motivation.yaml',
});

const GOAL = makeEntity({
  id: 'motivation.yaml-G001',
  displayId: 'G001',
  type: ENTITY_TYPE.Goal,
  layer: 'governance.motivation',
  fileOrigin: 'motivation.yaml',
});

describe('extractDecisionRelations', () => {
  it('extracts inquiry refs from motivation_refs.inquiries', () => {
    const decision = makeEntity({
      id: 'decisions.yaml-D001',
      displayId: 'D001',
      type: ENTITY_TYPE.Decision,
      data: {
        id: 'D001',
        title: 'Test decision',
        motivation_refs: {
          goals: ['G001'],
          inquiries: ['INQ001'],
        },
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractDecisionRelations([decision, INQUIRY, GOAL], placeholders);

    const inquiryRelations = relations.filter(
      (r) => r.type === RELATION_TYPE.MotivationRefs && r.predicate === 'inquiry'
    );
    expect(inquiryRelations).toHaveLength(1);
    expect(inquiryRelations[0]!.source_entity_id).toBe(decision.id);
    expect(inquiryRelations[0]!.target_entity_id).toBe(INQUIRY.id);
  });

  it('extracts goal refs from motivation_refs.goals', () => {
    const decision = makeEntity({
      id: 'decisions.yaml-D001',
      displayId: 'D001',
      type: ENTITY_TYPE.Decision,
      data: {
        id: 'D001',
        title: 'Test',
        motivation_refs: { goals: ['G001'] },
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractDecisionRelations([decision, GOAL], placeholders);

    const goalRelations = relations.filter(
      (r) => r.type === RELATION_TYPE.MotivationRefs && r.predicate === 'goal'
    );
    expect(goalRelations).toHaveLength(1);
    expect(goalRelations[0]!.target_entity_id).toBe(GOAL.id);
  });

  it('handles empty motivation_refs gracefully', () => {
    const decision = makeEntity({
      id: 'decisions.yaml-D002',
      displayId: 'D002',
      type: ENTITY_TYPE.Decision,
      data: { id: 'D002', title: 'Empty', motivation_refs: {} },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractDecisionRelations([decision], placeholders);
    expect(relations).toHaveLength(0);
  });

  it('creates placeholder for unresolved inquiry ref', () => {
    const decision = makeEntity({
      id: 'decisions.yaml-D001',
      displayId: 'D001',
      type: ENTITY_TYPE.Decision,
      data: {
        id: 'D001',
        title: 'Test',
        motivation_refs: { inquiries: ['INQ999'] },
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractDecisionRelations([decision], placeholders);

    expect(relations).toHaveLength(1);
    expect(placeholders.size).toBe(1);
    const placeholderEntity = [...placeholders.values()][0]!;
    expect(placeholderEntity.displayId).toBe('INQ999');
  });
});
