import { describe, it, expect } from 'vitest';
import { extractInquiryRelations } from './inquiry.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'governance.motivation',
    fileOrigin: 'orders/motivation.yaml',
    ...overrides,
  };
}

const GOAL = makeEntity({ id: 'orders-motivation.yaml-G001', displayId: 'orders.G001', type: ENTITY_TYPE.Goal });
const RISK = makeEntity({ id: 'orders-motivation.yaml-R001', displayId: 'orders.R001', type: ENTITY_TYPE.Risk });
const QUESTION = makeEntity({ id: 'orders-domain.yaml-QN001', displayId: 'orders.QN001', type: ENTITY_TYPE.Question, layer: 'design.domain', fileOrigin: 'orders/domain.yaml' });
const ACTOR1 = makeEntity({ id: 'orders-concepts.yaml-ACT001', displayId: 'orders.ACT001', type: ENTITY_TYPE.Actor, layer: 'design.concepts', fileOrigin: 'orders/concepts.yaml' });
const ACTOR2 = makeEntity({ id: 'orders-concepts.yaml-ACT002', displayId: 'orders.ACT002', type: ENTITY_TYPE.Actor, layer: 'design.concepts', fileOrigin: 'orders/concepts.yaml' });

describe('extractInquiryRelations', () => {
  it('T03-A08: goal_refs produce InquiryGoal relations', () => {
    const inquiry = makeEntity({
      id: 'orders-motivation.yaml-INQ001',
      displayId: 'orders.INQ001',
      type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ001', statement: 'Test', goal_refs: ['orders.G001'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractInquiryRelations([inquiry, GOAL], placeholders);
    const goalRels = relations.filter((r) => r.type === RELATION_TYPE.InquiryGoal);
    expect(goalRels).toHaveLength(1);
    expect(goalRels[0]!.source_entity_id).toBe(inquiry.id);
    expect(goalRels[0]!.target_entity_id).toBe(GOAL.id);
  });

  it('T03-A09: risk_refs produce InquiryRisk relations', () => {
    const inquiry = makeEntity({
      id: 'orders-motivation.yaml-INQ001',
      displayId: 'orders.INQ001',
      type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ001', statement: 'Test', risk_refs: ['orders.R001'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractInquiryRelations([inquiry, RISK], placeholders);
    const riskRels = relations.filter((r) => r.type === RELATION_TYPE.InquiryRisk);
    expect(riskRels).toHaveLength(1);
    expect(riskRels[0]!.target_entity_id).toBe(RISK.id);
  });

  it('T03-A10: question_refs produce InquiryQuestion relations', () => {
    const inquiry = makeEntity({
      id: 'orders-motivation.yaml-INQ001',
      displayId: 'orders.INQ001',
      type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ001', statement: 'Test', question_refs: ['orders.QN001'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractInquiryRelations([inquiry, QUESTION], placeholders);
    const questionRels = relations.filter((r) => r.type === RELATION_TYPE.InquiryQuestion);
    expect(questionRels).toHaveLength(1);
    expect(questionRels[0]!.target_entity_id).toBe(QUESTION.id);
  });

  it('T03-A11: owner produces InquiryOwner relation', () => {
    const inquiry = makeEntity({
      id: 'orders-motivation.yaml-INQ001',
      displayId: 'orders.INQ001',
      type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ001', statement: 'Test', owner: 'orders.ACT002' },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractInquiryRelations([inquiry, ACTOR2], placeholders);
    const ownerRels = relations.filter((r) => r.type === RELATION_TYPE.InquiryOwner);
    expect(ownerRels).toHaveLength(1);
    expect(ownerRels[0]!.target_entity_id).toBe(ACTOR2.id);
  });

  it('T03-A11b: stakeholders produce InquiryStakeholder relations', () => {
    const inquiry = makeEntity({
      id: 'orders-motivation.yaml-INQ001',
      displayId: 'orders.INQ001',
      type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ001', statement: 'Test', stakeholders: ['orders.ACT001', 'orders.ACT002'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractInquiryRelations([inquiry, ACTOR1, ACTOR2], placeholders);
    const stakeholderRels = relations.filter((r) => r.type === RELATION_TYPE.InquiryStakeholder);
    expect(stakeholderRels).toHaveLength(2);
  });

  it('T03-A11c: unresolvable refs create Missing placeholders', () => {
    const inquiry = makeEntity({
      id: 'orders-motivation.yaml-INQ001',
      displayId: 'orders.INQ001',
      type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ001', statement: 'Test', goal_refs: ['orders.G999'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractInquiryRelations([inquiry], placeholders);
    expect(relations).toHaveLength(1);
    expect(placeholders.size).toBe(1);
    const placeholder = Array.from(placeholders.values())[0]!;
    expect(placeholder.type).toBe(ENTITY_TYPE.Missing);
  });
});
