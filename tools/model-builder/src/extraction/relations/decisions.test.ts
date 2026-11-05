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

describe('extractDecisionRelations - declared_impact.direct', () => {
  const PROCESS = makeEntity({
    id: 'orders-story.yaml-PRC001',
    displayId: 'orders.PRC001',
    type: ENTITY_TYPE.Process,
    layer: 'story',
    fileOrigin: 'orders/story.yaml',
  });
  const IMPACT_TARGETS = [
    ['bounded_contexts', 'bounded_context', 'Context', 'orders.BC001'],
    ['services', 'service', 'Service', 'orders.SVC001'],
    ['infrastructure', 'infrastructure', 'InfraResource', 'orders.IR001'],
    ['environments', 'environment', 'Environment', 'orders.ENV001'],
  ] as const;

  function impactRelations(direct: Record<string, unknown>, others: Entity[]) {
    const decision = makeEntity({
      id: 'decisions.yaml-DC001',
      displayId: 'DC001',
      type: ENTITY_TYPE.Decision,
      data: { id: 'DC001', title: 'Test', declared_impact: { direct } },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractDecisionRelations([decision, ...others], placeholders);
    return {
      placeholders,
      relations: relations.filter((r) => r.type === RELATION_TYPE.DeclaredImpact),
    };
  }

  it('draws an edge from the decision to each process it lists under processes', () => {
    const { relations, placeholders } = impactRelations({ processes: ['orders.PRC001'] }, [PROCESS]);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.source_entity_id).toBe('decisions.yaml-DC001');
    expect(relations[0]!.target_entity_id).toBe(PROCESS.id);
    expect(relations[0]!.predicate).toBe('process');
    expect(placeholders.size).toBe(0);
  });

  it('still draws the edge for stories, the key models on schema lines before v2.8 write', () => {
    const { relations } = impactRelations({ stories: ['orders.PRC001'] }, [PROCESS]);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.target_entity_id).toBe(PROCESS.id);
    expect(relations[0]!.predicate).toBe('story');
  });

  it.each(IMPACT_TARGETS)('extracts %s as a declared impact edge', (key, predicate, type, ref) => {
    const target = makeEntity({ id: `target-${ref}`, displayId: ref, type, layer: 'design.arch', fileOrigin: 'arch.yaml' });
    const { relations, placeholders } = impactRelations({ [key]: [ref] }, [target]);
    expect(relations).toEqual([expect.objectContaining({ target_entity_id: target.id, predicate })]);
    expect(placeholders.size).toBe(0);
  });
});

describe('extractDecisionRelations - declared_impact.direct.packages (v2.8.84)', () => {
  const PACKAGE = makeEntity({ id: 'shop.arch.yaml-PKG001', displayId: 'PKG001', type: ENTITY_TYPE.Package, layer: 'design.arch', fileOrigin: 'shop.arch.yaml', data: { id: 'PKG001', name: 'DocumentToolkit' } });
  const decision = (packages: string[]) => makeEntity({
    id: 'orders-decisions.yaml-orders.DC001',
    displayId: 'orders.DC001',
    type: ENTITY_TYPE.Decision,
    fileOrigin: 'orders/decisions.yaml',
    data: { id: 'orders.DC001', title: 'One toolkit version', declared_impact: { direct: { packages } } },
  });

  it('draws one declared_impact edge with predicate package to each package it lists', () => {
    const relations = extractDecisionRelations([decision(['PKG001']), PACKAGE], new Map());
    expect(relations.map((r) => [r.type, r.predicate, r.target_entity_id])).toEqual([
      [RELATION_TYPE.DeclaredImpact, 'package', PACKAGE.id],
    ]);
  });

  it('a package nobody declares, or an id another type declares, is a placeholder rather than an edge', () => {
    const goal = makeEntity({ id: 'motivation.yaml-PKG777', displayId: 'PKG777', type: ENTITY_TYPE.Goal, layer: 'governance.motivation' });
    const placeholders = new Map<string, Entity>();
    const relations = extractDecisionRelations([decision(['PKG098', 'PKG777']), PACKAGE, goal], placeholders);
    expect(relations.map((r) => r.target_entity_id)).toEqual(['missing-PKG098', 'missing-PKG777']);
    expect(placeholders.size).toBe(2);
  });
});
