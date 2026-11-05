import { describe, it, expect } from 'vitest';
import { extractMotivationRelations } from './motivation.js';
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

describe('extractMotivationRelations - RiskGoal', () => {
  it('T03-A12: risk.goal_refs produce RiskGoal relations', () => {
    const risk = makeEntity({
      id: 'orders-motivation.yaml-R001',
      displayId: 'orders.R001',
      type: ENTITY_TYPE.Risk,
      data: { id: 'orders.R001', statement: 'Latency spike', goal_refs: ['orders.G001'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractMotivationRelations([risk, GOAL], placeholders);
    const goalRels = relations.filter((r) => r.type === RELATION_TYPE.RiskGoal);
    expect(goalRels).toHaveLength(1);
    expect(goalRels[0]!.source_entity_id).toBe(risk.id);
    expect(goalRels[0]!.target_entity_id).toBe(GOAL.id);
  });

  it('T03-A13: risk without goal_refs produces no RiskGoal (backward compat)', () => {
    const risk = makeEntity({
      id: 'orders-motivation.yaml-R001',
      displayId: 'orders.R001',
      type: ENTITY_TYPE.Risk,
      data: { id: 'orders.R001', statement: 'Latency spike' },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractMotivationRelations([risk], placeholders);
    const goalRels = relations.filter((r) => r.type === RELATION_TYPE.RiskGoal);
    expect(goalRels).toHaveLength(0);
  });

  it('risk.owner resolves to a team', () => {
    const team = makeEntity({ id: 'orders-organization.yaml-TM001', displayId: 'TM001', type: ENTITY_TYPE.Team, layer: 'organization', fileOrigin: 'organization.yaml' });
    const risk = makeEntity({ id: 'orders-motivation.yaml-R002', displayId: 'R002', type: ENTITY_TYPE.Risk, data: { id: 'R002', statement: 'Team owned', owner: 'TM001' } });
    const relations = extractMotivationRelations([risk, team], new Map<string, Entity>());
    expect(relations).toContainEqual(expect.objectContaining({ type: RELATION_TYPE.RiskOwner, target_entity_id: team.id }));
  });
});

describe('extractMotivationRelations - AssumptionRisk', () => {
  it('T03-A16: assumption.risk_refs produce AssumptionRisk relations', () => {
    const assumption = makeEntity({
      id: 'orders-motivation.yaml-A001',
      displayId: 'orders.A001',
      type: ENTITY_TYPE.Assumption,
      data: { id: 'orders.A001', statement: 'Stripe is available', risk_refs: ['orders.R001'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractMotivationRelations([assumption, RISK], placeholders);
    const riskRels = relations.filter((r) => r.type === RELATION_TYPE.AssumptionRisk);
    expect(riskRels).toHaveLength(1);
    expect(riskRels[0]!.source_entity_id).toBe(assumption.id);
    expect(riskRels[0]!.target_entity_id).toBe(RISK.id);
  });

  it('T03-A17: assumption without risk_refs produces no AssumptionRisk', () => {
    const assumption = makeEntity({
      id: 'orders-motivation.yaml-A001',
      displayId: 'orders.A001',
      type: ENTITY_TYPE.Assumption,
      data: { id: 'orders.A001', statement: 'Stripe is available' },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractMotivationRelations([assumption], placeholders);
    const riskRels = relations.filter((r) => r.type === RELATION_TYPE.AssumptionRisk);
    expect(riskRels).toHaveLength(0);
  });
});

describe('extractMotivationRelations - Vision forward-links (v2.7.7)', () => {
  const CAP = makeEntity({ id: 'archally-capability.yaml-CAP014', displayId: 'CAP014', type: ENTITY_TYPE.Capability });
  const VS = makeEntity({ id: 'archally-value-stream.yaml-VS005', displayId: 'VS005', type: ENTITY_TYPE.ValueStream });
  const VISION_GOAL = makeEntity({ id: 'archally-motivation.yaml-G001', displayId: 'G001', type: ENTITY_TYPE.Goal });

  it('T03-V10: vision.advances_goals / capability_refs / value_stream_refs produce forward relations', () => {
    const vision = makeEntity({
      id: 'archally-motivation.yaml-vision',
      displayId: 'vision',
      type: ENTITY_TYPE.Vision,
      layer: 'governance.motivation',
      fileOrigin: 'archally/motivation.yaml',
      data: { advances_goals: ['G001'], capability_refs: ['CAP014'], value_stream_refs: ['VS005'] },
    });
    const relations = extractMotivationRelations([vision, VISION_GOAL, CAP, VS], new Map<string, Entity>());
    expect(relations.filter((r) => r.type === RELATION_TYPE.VisionAdvancesGoal)).toHaveLength(1);
    expect(relations.filter((r) => r.type === RELATION_TYPE.VisionCapability)).toHaveLength(1);
    expect(relations.filter((r) => r.type === RELATION_TYPE.VisionValueStream)).toHaveLength(1);
    const goalRel = relations.find((r) => r.type === RELATION_TYPE.VisionAdvancesGoal)!;
    expect(goalRel.source_entity_id).toBe(vision.id);
    expect(goalRel.target_entity_id).toBe(VISION_GOAL.id);
  });

  it('T03-V11: vision with no forward-refs produces no vision relations', () => {
    const vision = makeEntity({
      id: 'archally-motivation.yaml-vision',
      displayId: 'vision',
      type: ENTITY_TYPE.Vision,
      data: { statement: 'Identity only.' },
    });
    const relations = extractMotivationRelations([vision], new Map<string, Entity>());
    expect(relations.filter((r) => r.type.startsWith('vision_'))).toHaveLength(0);
  });
});

describe('extractMotivationRelations - GoalKpi', () => {
  const KPI = makeEntity({
    id: 'orders-quality.yaml-KPI001',
    displayId: 'orders.KPI001',
    type: ENTITY_TYPE.KPI,
    layer: 'design.quality',
    fileOrigin: 'orders/quality.yaml',
  });

  it('goal.kpi produces a GoalKpi relation to the indicator it names', () => {
    const goal = makeEntity({
      id: 'orders-motivation.yaml-G002',
      displayId: 'orders.G002',
      type: ENTITY_TYPE.Goal,
      data: { id: 'orders.G002', statement: 'Checkout in under a second', kpi: 'orders.KPI001' },
    });
    const relations = extractMotivationRelations([goal, KPI], new Map<string, Entity>());
    const kpiRels = relations.filter((r) => r.type === RELATION_TYPE.GoalKpi);
    expect(kpiRels).toHaveLength(1);
    expect(kpiRels[0]!.source_entity_id).toBe(goal.id);
    expect(kpiRels[0]!.target_entity_id).toBe(KPI.id);
  });

  it('a goal without kpi produces no GoalKpi relation', () => {
    const goal = makeEntity({
      id: 'orders-motivation.yaml-G003',
      displayId: 'orders.G003',
      type: ENTITY_TYPE.Goal,
      data: { id: 'orders.G003', statement: 'Tracked in prose only', measure: 'p95 under 1s' },
    });
    const relations = extractMotivationRelations([goal, KPI], new Map<string, Entity>());
    expect(relations.filter((r) => r.type === RELATION_TYPE.GoalKpi)).toHaveLength(0);
  });
});

describe('extractMotivationRelations - GoalAssumption', () => {
  const PAYMENTS = makeEntity({
    id: 'orders-motivation.yaml-ASM001',
    displayId: 'orders.ASM001',
    type: ENTITY_TYPE.Assumption,
  });
  const CARRIERS = makeEntity({
    id: 'shipping-motivation.yaml-ASM002',
    displayId: 'shipping.ASM002',
    type: ENTITY_TYPE.Assumption,
    fileOrigin: 'shipping/motivation.yaml',
  });

  it('goal.assumption_refs produce one GoalAssumption relation per assumption the goal rests on', () => {
    const goal = makeEntity({
      id: 'orders-motivation.yaml-G004',
      displayId: 'orders.G004',
      type: ENTITY_TYPE.Goal,
      data: {
        id: 'orders.G004',
        statement: 'Every paid order ships within a day',
        assumption_refs: ['orders.ASM001', 'shipping.ASM002'],
      },
    });
    const relations = extractMotivationRelations([goal, PAYMENTS, CARRIERS], new Map<string, Entity>());
    const premises = relations.filter((r) => r.type === RELATION_TYPE.GoalAssumption);
    expect(premises.map((r) => [r.source_entity_id, r.target_entity_id])).toEqual([
      [goal.id, PAYMENTS.id],
      [goal.id, CARRIERS.id],
    ]);
  });

  it('an assumption id that names nothing becomes a placeholder, as every other motivation ref does', () => {
    const goal = makeEntity({
      id: 'orders-motivation.yaml-G005',
      displayId: 'orders.G005',
      type: ENTITY_TYPE.Goal,
      data: { id: 'orders.G005', statement: 'Refunds settle in a week', assumption_refs: ['orders.ASM099'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractMotivationRelations([goal], placeholders);
    const premises = relations.filter((r) => r.type === RELATION_TYPE.GoalAssumption);
    expect(premises).toHaveLength(1);
    expect(placeholders.has(premises[0]!.target_entity_id)).toBe(true);
  });

  it('a goal without assumption_refs produces no GoalAssumption relation', () => {
    const goal = makeEntity({
      id: 'orders-motivation.yaml-G006',
      displayId: 'orders.G006',
      type: ENTITY_TYPE.Goal,
      data: { id: 'orders.G006', statement: 'Rests on nothing stated' },
    });
    const relations = extractMotivationRelations([goal, PAYMENTS], new Map<string, Entity>());
    expect(relations.filter((r) => r.type === RELATION_TYPE.GoalAssumption)).toHaveLength(0);
  });
});
