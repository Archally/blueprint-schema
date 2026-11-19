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
const TEAM = makeEntity({ id: 'orders-organization.yaml-TM001', displayId: 'orders.TM001', type: ENTITY_TYPE.Team, layer: 'organization', fileOrigin: 'organization.yaml' });
const FINDING = makeEntity({ id: 'orders-quality.yaml-FN001', displayId: 'orders.FN001', type: ENTITY_TYPE.Finding, layer: 'design.quality', fileOrigin: 'quality.yaml' });

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

  it('finding_refs produce InquiryFinding and owner resolves to a team', () => {
    const inquiry = makeEntity({
      id: 'orders-motivation.yaml-INQ001', displayId: 'orders.INQ001', type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ001', statement: 'Test', finding_refs: ['orders.FN001'], owner: 'orders.TM001' },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractInquiryRelations([inquiry, FINDING, TEAM], placeholders);
    expect(relations.map((relation) => [relation.type, relation.target_entity_id])).toEqual([
      [RELATION_TYPE.InquiryFinding, FINDING.id], [RELATION_TYPE.InquiryOwner, TEAM.id],
    ]);
    expect(placeholders.size).toBe(0);
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
  describe('the addressee and the earlier addressees', () => {
    const TEAM3 = makeEntity({ id: 'org-organization.yaml-TM003', displayId: 'TM003', type: ENTITY_TYPE.Team, layer: 'organization', fileOrigin: 'organization.yaml' });
    const inquiryWith = (data: Record<string, unknown>) => makeEntity({
      id: 'orders-motivation.yaml-INQ101', displayId: 'orders.INQ101', type: ENTITY_TYPE.Inquiry,
      data: { id: 'orders.INQ101', statement: 'How long are declined payments kept?', ...data },
    });

    it('asked_of draws InquiryAskedOf to its actor or team, apart from the owner edge', () => {
      const placeholders = new Map<string, Entity>();
      const relations = extractInquiryRelations(
        [inquiryWith({ owner: 'orders.TM001', asked_of: { team: 'TM003', name: 'Architects' } }), TEAM, TEAM3],
        placeholders,
      );
      expect(relations.map((relation) => [relation.type, relation.target_entity_id, relation.data])).toEqual([
        [RELATION_TYPE.InquiryOwner, TEAM.id, undefined],
        [RELATION_TYPE.InquiryAskedOf, TEAM3.id, { name: 'Architects' }],
      ]);
      expect(placeholders.size).toBe(0);
    });

    it('a name alone draws no edge and creates no placeholder', () => {
      const placeholders = new Map<string, Entity>();
      const relations = extractInquiryRelations(
        [inquiryWith({ asked_of: { name: 'Domain expert' }, previously_asked_of: [{ asked_of: { name: 'Support desk' }, outcome: 'redirected' }] })],
        placeholders,
      );
      expect(relations).toEqual([]);
      expect(placeholders.size).toBe(0);
    });

    it('each earlier addressee is one InquiryPreviouslyAskedOf edge with its position, outcome and date, a repeat included', () => {
      const placeholders = new Map<string, Entity>();
      const relations = extractInquiryRelations([
        inquiryWith({
          asked_of: { team: 'TM003' },
          previously_asked_of: [
            { asked_of: { actor: 'orders.ACT001' }, outcome: 'partly-answered', date: '2026-10-02' },
            { asked_of: { team: 'TM003' }, outcome: 'reassigned' },
            { asked_of: { actor: 'orders.ACT001' }, outcome: 'redirected' },
          ],
        }),
        ACTOR1, TEAM3,
      ], placeholders);
      const earlier = relations.filter((relation) => relation.type === RELATION_TYPE.InquiryPreviouslyAskedOf);
      expect(earlier.map((relation) => [relation.target_entity_id, relation.data])).toEqual([
        [ACTOR1.id, { position: 0, outcome: 'partly-answered', date: '2026-10-02' }],
        [TEAM3.id, { position: 1, outcome: 'reassigned' }],
        [ACTOR1.id, { position: 2, outcome: 'redirected' }],
      ]);
      expect(new Set(earlier.map((relation) => relation.id)).size).toBe(3);
      expect(relations.filter((relation) => relation.type === RELATION_TYPE.InquiryAskedOf).map((relation) => relation.target_entity_id)).toEqual([TEAM3.id]);
    });

    it('an addressee nobody declares points at a Missing placeholder, current and earlier alike', () => {
      const placeholders = new Map<string, Entity>();
      const relations = extractInquiryRelations(
        [inquiryWith({ asked_of: { actor: 'orders.ACT099' }, previously_asked_of: [{ asked_of: { team: 'TM999' }, outcome: 'reassigned' }] })],
        placeholders,
      );
      expect(relations.map((relation) => relation.target_entity_id)).toEqual(['missing-orders-ACT099', 'missing-TM999']);
      expect([...placeholders.values()].map((placeholder) => placeholder.type)).toEqual([ENTITY_TYPE.Missing, ENTITY_TYPE.Missing]);
    });

    it('an inquiry with an owner and no addressee draws no addressee edge', () => {
      const relations = extractInquiryRelations([inquiryWith({ owner: 'orders.TM001', status: 'deferred' }), TEAM], new Map());
      expect(relations.map((relation) => relation.type)).toEqual([RELATION_TYPE.InquiryOwner]);
    });
  });
});
