import { describe, it, expect } from 'vitest';
import { extractMotivation } from './motivation.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractMotivation — Inquiry extraction', () => {
  it('T03-A01: minimal inquiry (id + statement) produces Entity with type Inquiry', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        inquiries: [
          { id: 'INQ001', statement: 'Should we use a rules engine?' },
        ],
      },
      filePath: 'orders/motivation.yaml',
      scope: 'orders',
    };
    const entities = extractMotivation(doc);
    const inquiries = entities.filter((e) => e.type === ENTITY_TYPE.Inquiry);
    expect(inquiries).toHaveLength(1);
    expect(inquiries[0]!.displayId).toBe('INQ001');
    expect(inquiries[0]!.layer).toBe('governance.motivation');
    expect(inquiries[0]!.description).toBe('Should we use a rules engine?');
  });

  it('T03-A02: full inquiry with all optional fields preserves data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        inquiries: [
          {
            id: 'orders.INQ001',
            statement: 'Should we migrate cart rules to a rules engine?',
            summary: 'Cart rules engine migration',
            description: 'Detailed context about the migration.',
            category: 'technical',
            goal_refs: ['orders.G001'],
            risk_refs: ['orders.R001'],
            question_refs: ['orders.QN001'],
            stakeholders: ['orders.ACT001'],
            owner: 'orders.ACT002',
            blocking: false,
            status: 'investigating',
            discovery_stage: 'exploring',
            certainty: 'speculative',
            tags: ['architecture'],
          },
        ],
      },
      filePath: 'orders/motivation.yaml',
      scope: 'orders',
    };
    const entities = extractMotivation(doc);
    const inquiry = entities.find((e) => e.type === ENTITY_TYPE.Inquiry);
    expect(inquiry).toBeDefined();
    expect(inquiry!.displayId).toBe('orders.INQ001');
    const data = inquiry!.data as Record<string, unknown>;
    expect(data.category).toBe('technical');
    expect(data.goal_refs).toEqual(['orders.G001']);
    expect(data.risk_refs).toEqual(['orders.R001']);
    expect(data.question_refs).toEqual(['orders.QN001']);
    expect(data.stakeholders).toEqual(['orders.ACT001']);
    expect(data.owner).toBe('orders.ACT002');
    expect(data.blocking).toBe(false);
    expect(data.discovery_stage).toBe('exploring');
    expect(data.certainty).toBe('speculative');
  });

  it('T03-A03: empty inquiries[] produces no Inquiry entities', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0', inquiries: [] },
      filePath: 'orders/motivation.yaml',
      scope: 'orders',
    };
    const entities = extractMotivation(doc);
    const inquiries = entities.filter((e) => e.type === ENTITY_TYPE.Inquiry);
    expect(inquiries).toHaveLength(0);
  });

  it('T03-A04: inquiries coexist with goals, risks, etc. in same doc', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        goals: [{ id: 'G001', statement: 'Improve conversion', priority: 'high' }],
        risks: [{ id: 'R001', statement: 'Latency spike', likelihood: 'high', impact: 'critical' }],
        inquiries: [
          { id: 'INQ001', statement: 'Cart rules engine?' },
          { id: 'INQ002', statement: 'EU exchange rate?' },
        ],
      },
      filePath: 'orders/motivation.yaml',
      scope: 'orders',
    };
    const entities = extractMotivation(doc);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Goal)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Risk)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Inquiry)).toHaveLength(2);
  });

  it('T03-A04b: existing goal/risk/assumption/trade_off extraction unchanged', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        goals: [{ id: 'G001', statement: 'Fast checkout', priority: 'critical' }],
        non_goals: [{ id: 'NG001', statement: 'No marketplace' }],
        risks: [{ id: 'R001', statement: 'Latency', likelihood: 'high', impact: 'high' }],
        assumptions: [{ id: 'A001', statement: 'Stripe is available' }],
        trade_offs: [{ id: 'T001', choice: 'Guest checkout vs registration', selected: 'Guest' }],
      },
      filePath: 'orders/motivation.yaml',
      scope: 'orders',
    };
    const entities = extractMotivation(doc);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Goal)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.NonGoal)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Risk)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Assumption)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.TradeOff)).toHaveLength(1);
  });
});

