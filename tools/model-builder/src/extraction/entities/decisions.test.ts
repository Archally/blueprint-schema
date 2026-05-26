import { describe, it, expect } from 'vitest';
import { extractDecisions } from './decisions.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractDecisions', () => {
  it('returns Decision entities with layer governance.decisions', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        decisions: [
          { id: 'D001', title: 'Use REST for orders API', summary: 'REST chosen over GraphQL', date: '2025-01-01', status: 'accepted', rationale: { problem: 'Need simple API', chosen: 'REST' } },
        ],
      },
      filePath: 'orders/decisions.yaml',
      scope: 'orders',
    };
    const entities = extractDecisions(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Decision);
    expect(entities[0]!.layer).toBe('governance.decisions');
    expect(entities[0]!.displayId).toBe('D001');
    expect(entities[0]!.id).toBe('orders-decisions.yaml-D001');
  });

  // T04c-08 — BCC v5 (v2.6.3) BusinessDecision extraction
  it('emits BusinessDecision entities from business_decisions[] (BCC v5)', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        business_decisions: [
          {
            id: 'BD001',
            name: 'Order modifications allowed within 30 minutes',
            description: 'Customers may amend orders within 30 minutes of placement.',
            bounded_context_ref: 'orders',
          },
        ],
      },
      filePath: 'orders/decisions.yaml',
      scope: 'orders',
    };
    const entities = extractDecisions(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.BusinessDecision);
    expect(entities[0]!.layer).toBe('governance.decisions');
    expect(entities[0]!.displayId).toBe('BD001');
    expect(entities[0]!.summary).toBe('Order modifications allowed within 30 minutes');
    expect(entities[0]!.data?.bounded_context_ref).toBe('orders');
  });

  it('emits Decision and BusinessDecision entities side-by-side from one file', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        decisions: [
          { id: 'D001', title: 'ADR Title', date: '2025-01-01', status: 'accepted', rationale: { problem: 'p', chosen: 'c' } },
        ],
        business_decisions: [
          { id: 'BD001', name: 'Policy Name', description: 'Policy text', bounded_context_ref: 'orders' },
        ],
      },
      filePath: 'orders/decisions.yaml',
      scope: 'orders',
    };
    const entities = extractDecisions(doc);
    expect(entities).toHaveLength(2);
    const types = entities.map((e) => e.type).sort();
    expect(types).toEqual([ENTITY_TYPE.BusinessDecision, ENTITY_TYPE.Decision].sort());
  });
});
