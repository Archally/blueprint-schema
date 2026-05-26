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

describe('extractMotivationRelations — RiskGoal', () => {
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
});

describe('extractMotivationRelations — AssumptionRisk', () => {
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
