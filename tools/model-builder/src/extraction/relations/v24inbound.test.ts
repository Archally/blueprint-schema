import { describe, it, expect } from 'vitest';
import { extractTestCaseRelations } from './testCases.js';
import { extractDecisionRelations } from './decisions.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

describe('v2.4 inbound question relations', () => {
  it('T03-12b: testCase validates.questions creates validates relation with question predicate', () => {
    const entities: Entity[] = [
      {
        id: 'orders-test-cases.yaml-TC001',
        displayId: 'TC001',
        type: ENTITY_TYPE.TestCase,
        layer: 'governance.tests',
        fileOrigin: 'orders/test-cases.yaml',
        data: {
          id: 'TC001',
          name: 'Order status query',
          suite: 'happy_path',
          validates: {
            operations: ['QRY001'],
            questions: ['QN001'],
          },
        },
      },
      {
        id: 'orders-domain.yaml-QRY001',
        displayId: 'QRY001',
        type: ENTITY_TYPE.Operation,
        layer: 'design.domain',
        fileOrigin: 'orders/domain.yaml',
      },
      {
        id: 'orders-domain.yaml-QN001',
        displayId: 'QN001',
        type: ENTITY_TYPE.Question,
        layer: 'design.domain',
        fileOrigin: 'orders/domain.yaml',
      },
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractTestCaseRelations(entities, placeholders);

    const questionRels = relations.filter((r) => r.predicate === 'question');
    expect(questionRels).toHaveLength(1);
    expect(questionRels[0]!.type).toBe(RELATION_TYPE.Validates);
    expect(questionRels[0]!.source_entity_id).toBe('orders-test-cases.yaml-TC001');
    expect(questionRels[0]!.target_entity_id).toBe('orders-domain.yaml-QN001');

    const opRels = relations.filter((r) => r.predicate === 'operation');
    expect(opRels).toHaveLength(1);
  });

  it('T03-12b: decision motivation_refs.questions creates motivation_refs relation with question predicate', () => {
    const entities: Entity[] = [
      {
        id: 'orders-decisions.yaml-D001',
        displayId: 'D001',
        type: ENTITY_TYPE.Decision,
        layer: 'governance.decisions',
        fileOrigin: 'orders/decisions.yaml',
        data: {
          id: 'D001',
          title: 'Use CQRS for orders',
          date: '2024-01',
          status: 'accepted',
          rationale: { problem: 'test', chosen: 'CQRS' },
          motivation_refs: {
            goals: ['GL001'],
            questions: ['QN001', 'QN002'],
          },
        },
      },
      {
        id: 'orders-motivation.yaml-GL001',
        displayId: 'GL001',
        type: ENTITY_TYPE.Goal,
        layer: 'governance.motivation',
        fileOrigin: 'orders/motivation.yaml',
      },
      {
        id: 'orders-domain.yaml-QN001',
        displayId: 'QN001',
        type: ENTITY_TYPE.Question,
        layer: 'design.domain',
        fileOrigin: 'orders/domain.yaml',
      },
      {
        id: 'orders-domain.yaml-QN002',
        displayId: 'QN002',
        type: ENTITY_TYPE.Question,
        layer: 'design.domain',
        fileOrigin: 'orders/domain.yaml',
      },
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractDecisionRelations(entities, placeholders);

    const questionRels = relations.filter((r) => r.predicate === 'question');
    expect(questionRels).toHaveLength(2);
    expect(questionRels.every((r) => r.type === RELATION_TYPE.MotivationRefs)).toBe(true);
    expect(questionRels[0]!.source_entity_id).toBe('orders-decisions.yaml-D001');
    expect(questionRels[0]!.target_entity_id).toBe('orders-domain.yaml-QN001');
    expect(questionRels[1]!.target_entity_id).toBe('orders-domain.yaml-QN002');

    const goalRels = relations.filter((r) => r.predicate === 'goal');
    expect(goalRels).toHaveLength(1);
  });
});
