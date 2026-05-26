import { describe, it, expect } from 'vitest';
import { extractDomain } from './domain.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractDomain v2.4 — questions', () => {
  it('T03-11: extracts questions as Question entities', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Orders',
        operations: [
          { id: 'QRY001', kind: 'query', name: 'Get Order Status' },
        ],
        questions: [
          {
            id: 'QN001',
            statement: 'What is the current status of a customer order?',
            name: 'Order Status',
            summary: 'Current order status query',
            category: 'existence',
            priority: 'critical',
            answered_by: ['QRY001'],
            concepts: ['CN001'],
            motivated_by: ['GL001'],
            stakeholders: ['ACT001'],
          },
          {
            id: 'QN002',
            statement: 'Can a customer cancel an order after shipping?',
            description: 'Tests cancellation policy boundaries',
          },
        ],
      },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };

    const entities = extractDomain(doc);
    const questions = entities.filter((e) => e.type === ENTITY_TYPE.Question);
    const operations = entities.filter((e) => e.type === ENTITY_TYPE.Operation);

    expect(operations).toHaveLength(1);
    expect(questions).toHaveLength(2);

    const qn1 = questions.find((e) => e.displayId === 'QN001')!;
    expect(qn1).toBeDefined();
    expect(qn1.type).toBe('Question');
    expect(qn1.layer).toBe('design.domain');
    expect(qn1.term).toBe('Order Status');
    expect(qn1.summary).toBe('Current order status query');
    expect(qn1.id).toContain('QN001');
    expect(qn1.fileOrigin).toBe('orders/domain.yaml');
    // raw data preserved
    expect((qn1.data as Record<string, unknown>).category).toBe('existence');
    expect((qn1.data as Record<string, unknown>).priority).toBe('critical');
    expect((qn1.data as Record<string, unknown>).answered_by).toEqual(['QRY001']);

    const qn2 = questions.find((e) => e.displayId === 'QN002')!;
    expect(qn2).toBeDefined();
    // statement used as description when description is also provided
    expect(qn2.description).toBe('Tests cancellation policy boundaries');
    // summary falls back to statement when no summary/name
    expect(qn2.summary).toBe('Can a customer cancel an order after shipping?');
  });

  it('skips questions without id', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Orders',
        operations: [],
        questions: [
          { statement: 'No id question' },
          { id: 'QN001', statement: 'Valid question' },
        ],
      },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };
    const entities = extractDomain(doc);
    const questions = entities.filter((e) => e.type === ENTITY_TYPE.Question);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.displayId).toBe('QN001');
  });

  it('returns empty when no questions and no operations', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0', name: 'Empty', operations: [] },
      filePath: 'empty/domain.yaml',
    };
    const entities = extractDomain(doc);
    expect(entities).toHaveLength(0);
  });

  it('preserves operation examples, idempotent, correlation_id in data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Orders',
        operations: [
          {
            id: 'CMD001',
            kind: 'command',
            name: 'Submit Order',
            idempotent: true,
            idempotency_key: '$.headers.Idempotency-Key',
            correlation_id: {
              location: '$.headers.X-Correlation-ID',
              description: 'Distributed tracing correlation',
            },
            examples: [
              {
                name: 'valid-order',
                description: 'Standard order submission',
                provider_state: 'customer exists',
                test_ref: 'TC001',
                scenario: 'happy-path',
              },
            ],
          },
        ],
      },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };
    const entities = extractDomain(doc);
    expect(entities).toHaveLength(1);
    const op = entities[0]!;
    const data = op.data as Record<string, unknown>;
    expect(data.idempotent).toBe(true);
    expect(data.idempotency_key).toBe('$.headers.Idempotency-Key');
    expect(data.correlation_id).toEqual({
      location: '$.headers.X-Correlation-ID',
      description: 'Distributed tracing correlation',
    });
    expect(data.examples).toHaveLength(1);
    expect((data.examples as Record<string, unknown>[])[0]!.provider_state).toBe('customer exists');
    expect((data.examples as Record<string, unknown>[])[0]!.test_ref).toBe('TC001');
  });
});
