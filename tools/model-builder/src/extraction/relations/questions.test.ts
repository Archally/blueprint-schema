import { describe, it, expect } from 'vitest';
import { extractQuestionRelations } from './questions.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function makeEntity(overrides: Partial<Entity> & { id: string; displayId: string; type: string }): Entity {
  return {
    layer: 'design.domain',
    fileOrigin: 'orders/domain.yaml',
    ...overrides,
  };
}

describe('extractQuestionRelations', () => {
  it('T03-12: creates answered_by relations to operations of any kind', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-domain.yaml-QN001',
        displayId: 'QN001',
        type: ENTITY_TYPE.Question,
        data: {
          id: 'QN001',
          statement: 'What is the order status?',
          answered_by: ['QRY001', 'CMD002'],
        },
      }),
      makeEntity({ id: 'orders-domain.yaml-QRY001', displayId: 'QRY001', type: ENTITY_TYPE.Operation }),
      makeEntity({ id: 'orders-domain.yaml-CMD002', displayId: 'CMD002', type: ENTITY_TYPE.Operation }),
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractQuestionRelations(entities, placeholders);

    const answeredBy = relations.filter((r) => r.type === RELATION_TYPE.QuestionAnsweredBy);
    expect(answeredBy).toHaveLength(2);
    expect(answeredBy[0]!.source_entity_id).toBe('orders-domain.yaml-QN001');
    expect(answeredBy[0]!.target_entity_id).toBe('orders-domain.yaml-QRY001');
    expect(answeredBy[1]!.target_entity_id).toBe('orders-domain.yaml-CMD002');
  });

  it('T03-12c: answered_by CMD creates correct edge', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-domain.yaml-QN001',
        displayId: 'QN001',
        type: ENTITY_TYPE.Question,
        data: { id: 'QN001', statement: 'Can order be cancelled?', answered_by: ['CMD003'] },
      }),
      makeEntity({ id: 'orders-domain.yaml-CMD003', displayId: 'CMD003', type: ENTITY_TYPE.Operation }),
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractQuestionRelations(entities, placeholders);
    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe(RELATION_TYPE.QuestionAnsweredBy);
    expect(relations[0]!.target_entity_id).toBe('orders-domain.yaml-CMD003');
  });

  it('T03-12: creates concept, motivated_by, stakeholder relations', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-domain.yaml-QN001',
        displayId: 'QN001',
        type: ENTITY_TYPE.Question,
        data: {
          id: 'QN001',
          statement: 'What is the order status?',
          concepts: ['CN001', 'CN002'],
          motivated_by: ['GL001'],
          stakeholders: ['ACT001'],
        },
      }),
      makeEntity({ id: 'orders-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, fileOrigin: 'orders/concepts.yaml' }),
      makeEntity({ id: 'orders-concepts.yaml-CN002', displayId: 'CN002', type: ENTITY_TYPE.Concept, fileOrigin: 'orders/concepts.yaml' }),
      makeEntity({ id: 'orders-motivation.yaml-GL001', displayId: 'GL001', type: ENTITY_TYPE.Goal, layer: 'governance.motivation', fileOrigin: 'orders/motivation.yaml' }),
      makeEntity({ id: 'orders-concepts.yaml-ACT001', displayId: 'ACT001', type: ENTITY_TYPE.Actor, fileOrigin: 'orders/concepts.yaml' }),
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractQuestionRelations(entities, placeholders);

    const aboutRels = relations.filter((r) => r.type === RELATION_TYPE.QuestionAbout);
    expect(aboutRels).toHaveLength(2);

    const motivatedByRels = relations.filter((r) => r.type === RELATION_TYPE.QuestionMotivatedBy);
    expect(motivatedByRels).toHaveLength(1);
    expect(motivatedByRels[0]!.target_entity_id).toBe('orders-motivation.yaml-GL001');

    const stakeholderRels = relations.filter((r) => r.type === RELATION_TYPE.QuestionStakeholder);
    expect(stakeholderRels).toHaveLength(1);
    expect(stakeholderRels[0]!.target_entity_id).toBe('orders-concepts.yaml-ACT001');
  });

  it('creates Missing placeholder for unresolvable refs', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-domain.yaml-QN001',
        displayId: 'QN001',
        type: ENTITY_TYPE.Question,
        data: { id: 'QN001', statement: 'Test', answered_by: ['MISSING001'] },
      }),
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractQuestionRelations(entities, placeholders);
    expect(relations).toHaveLength(1);
    expect(placeholders.size).toBe(1);
    const placeholder = Array.from(placeholders.values())[0]!;
    expect(placeholder.type).toBe(ENTITY_TYPE.Missing);
    expect(placeholder.displayId).toBe('MISSING001');
  });
});
