import { describe, it, expect } from 'vitest';
import { extractDomain } from './domain.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractDomain', () => {
  it('returns two Operation entities for operations object with two ops', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Orders',
        operations: {
          'op.orders.submit': {
            id: 'OP001',
            kind: 'command',
            name: 'Submit Order',
            description: 'Submit draft order',
            exchange: { protocol: 'http', endpoint: { path: '/orders/submit', method: 'POST', group: 'orders' } },
          },
          'op.orders.get': {
            id: 'OP002',
            kind: 'query',
            name: 'Get Order',
            exchange: { protocol: 'http', endpoint: { path: '/orders/{id}', method: 'GET', group: 'orders' } },
          },
        },
      },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };
    const entities = extractDomain(doc);
    expect(entities).toHaveLength(2);
    expect(entities.every((e) => e.type === ENTITY_TYPE.Operation)).toBe(true);
    expect(entities.map((e) => e.displayId).sort()).toEqual(['OP001', 'OP002']);
    expect(entities[0]!.layer).toBe('design.domain');
    expect(entities[0]!.id).toContain('OP001');
  });

  it('uses operation key as displayId when op.id is missing', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Catalog',
        operations: {
          'op.get_product': { kind: 'query', name: 'Get Product', exchange: { protocol: 'http', endpoint: { path: '/products', method: 'GET', group: 'catalog' } } },
        },
      },
      filePath: 'catalog/domain.yaml',
    };
    const entities = extractDomain(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.displayId).toBe('op.get_product');
  });

  it('v2.1: extracts operations from array format with op.id', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Orders',
        operations: [
          {
            id: 'CMD001',
            kind: 'command',
            name: 'Submit Order',
            exchange: { protocol: 'http', endpoint: { path: '/orders/submit', method: 'POST', group: 'orders' } },
          },
          {
            id: 'EVT002',
            kind: 'event',
            name: 'Order Submitted',
            exchange: { protocol: 'amqp', topic: { name: 'orders.submitted' } },
          },
        ],
      },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };
    const entities = extractDomain(doc);
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.displayId).sort()).toEqual(['CMD001', 'EVT002']);
    expect(entities[0]!.term).toBe('Submit Order');
  });

  it('T03-A-ERR01: extracts Error entities from errors dictionary', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Orders',
        operations: {},
        errors: {
          insufficientStock: {
            id: 'orders.ERR001',
            name: 'InsufficientStock',
            description: 'Stock quantity exceeded.',
            category: 'validation',
            severity: 'error',
            http_status: 409,
          },
          paymentDeclined: {
            id: 'orders.ERR002',
            name: 'PaymentDeclined',
            description: 'Payment gateway rejected.',
            category: 'external',
            severity: 'error',
            http_status: 402,
          },
        },
      },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };
    const entities = extractDomain(doc);
    const errors = entities.filter((e) => e.type === ENTITY_TYPE.Error);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.displayId).sort()).toEqual(['orders.ERR001', 'orders.ERR002']);
    expect(errors[0]!.layer).toBe('design.domain');
    const data = errors[0]!.data as Record<string, unknown>;
    expect(data.category).toBe('validation');
    expect(data.http_status).toBe(409);
  });

  it('T03-A-ERR02: errors coexist with operations in same doc', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        name: 'Orders',
        operations: {
          placeOrder: { id: 'CMD001', kind: 'command', name: 'PlaceOrder' },
        },
        errors: {
          notFound: { id: 'ERR001', name: 'OrderNotFound', description: 'Not found.' },
        },
      },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };
    const entities = extractDomain(doc);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Operation)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Error)).toHaveLength(1);
  });

  it('T03-A-ERR03: empty errors dictionary produces no Error entities', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0', name: 'Orders', operations: {}, errors: {} },
      filePath: 'orders/domain.yaml',
      scope: 'orders',
    };
    const entities = extractDomain(doc);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Error)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Phase 2 step-03 — context-link injection on Operation / Error / Question
  // ---------------------------------------------------------------------

  describe('Phase 2 step-03 — context link injection', () => {
    it('propagates doc.data.name as _context_name onto every Operation', () => {
      const doc: ParsedBlueprintDocument = {
        data: {
          version: '1.0.0',
          name: 'Klienci',
          operations: {
            requestAuthorization: { id: 'customers.CMD001', kind: 'command', name: 'Request' },
            consentDocument: { id: 'customers.DOC001', kind: 'document', name: 'Consent' },
          },
        },
        filePath: 'customers/domain.yaml',
        scope: 'customers',
      };
      const entities = extractDomain(doc);
      const ops = entities.filter((e) => e.type === ENTITY_TYPE.Operation);
      expect(ops).toHaveLength(2);
      for (const op of ops) {
        const data = op.data as Record<string, unknown>;
        expect(data._context_name).toBe('Klienci');
        expect(data._scope).toBe('customers');
        // Original fields preserved.
        expect(data.kind).toBeDefined();
        expect(data.id).toBeDefined();
      }
    });

    it('propagates _context_name onto Error entities (v2.5)', () => {
      const doc: ParsedBlueprintDocument = {
        data: {
          version: '1.0.0',
          name: 'Orders',
          errors: {
            invalidOrder: { id: 'orders.ERR001', name: 'Invalid Order', category: 'validation' },
          },
        },
        filePath: 'orders/domain.yaml',
        scope: 'orders',
      };
      const entities = extractDomain(doc);
      const error = entities.find((e) => e.type === ENTITY_TYPE.Error);
      expect(error).toBeDefined();
      const data = error!.data as Record<string, unknown>;
      expect(data._context_name).toBe('Orders');
      expect(data._scope).toBe('orders');
    });

    it('propagates _context_name onto Question entities (v2.4)', () => {
      const doc: ParsedBlueprintDocument = {
        data: {
          version: '1.0.0',
          name: 'Orders',
          questions: [
            { id: 'QN001', name: 'Pricing strategy', statement: 'Tax-inclusive or exclusive?' },
          ],
        },
        filePath: 'orders/domain.yaml',
        scope: 'orders',
      };
      const entities = extractDomain(doc);
      const question = entities.find((e) => e.type === 'Question');
      expect(question).toBeDefined();
      const data = question!.data as Record<string, unknown>;
      expect(data._context_name).toBe('Orders');
      expect(data._scope).toBe('orders');
    });

    it('omits _context_name when doc.data.name is missing', () => {
      const doc: ParsedBlueprintDocument = {
        data: {
          version: '1.0.0',
          operations: { foo: { id: 'OP001', kind: 'command' } },
        },
        filePath: 'mystery/domain.yaml',
        scope: undefined,
      };
      const entities = extractDomain(doc);
      const data = entities[0]!.data as Record<string, unknown>;
      expect('_context_name' in data).toBe(false);
      expect('_scope' in data).toBe(false);
    });

    it('does not mutate source operation objects (clone semantics)', () => {
      const op = { id: 'OP001', kind: 'command', name: 'Submit' };
      const doc: ParsedBlueprintDocument = {
        data: { version: '1.0.0', name: 'Orders', operations: { submit: op } },
        filePath: 'orders/domain.yaml',
        scope: 'orders',
      };
      extractDomain(doc);
      expect('_context_name' in op).toBe(false);
      expect('_scope' in op).toBe(false);
    });
  });
});
