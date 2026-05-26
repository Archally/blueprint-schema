import { describe, it, expect } from 'vitest';
import { extractConcepts } from './concepts.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractConcepts', () => {
  it('returns one entity with type Concept, layer design.concepts for minimal concepts doc', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        concepts: [
          {
            id: 'CN001',
            term: 'Todo Item',
            summary: 'A task to be completed',
            definition: 'A unit of work with title and status',
          },
        ],
      },
      filePath: 'billing/concepts.yaml',
      scope: 'billing',
    };
    const entities = extractConcepts(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Concept);
    expect(entities[0]!.layer).toBe('design.concepts');
    expect(entities[0]!.displayId).toBe('CN001');
    expect(entities[0]!.id).toBe('billing-concepts.yaml-CN001');
    expect(entities[0]!.term).toBe('Todo Item');
    expect(entities[0]!.fileOrigin).toBe('billing/concepts.yaml');
  });

  it('prioritizes name over term for v2.3 vocabulary', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        concepts: [
          { id: 'CN001', name: 'Order', description: 'A customer purchase request' },
        ],
      },
      filePath: 'concepts.yaml',
      scope: undefined,
    };
    const entities = extractConcepts(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.term).toBe('Order');
    expect(entities[0]!.description).toBe('A customer purchase request');
  });

  it('uses term as fallback when name is absent (v2.1 compat)', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        concepts: [
          { id: 'CN001', term: 'Order', definition: 'A binding purchase request' },
        ],
      },
      filePath: 'concepts.yaml',
      scope: undefined,
    };
    const entities = extractConcepts(doc);
    expect(entities[0]!.term).toBe('Order');
    expect(entities[0]!.description).toBe('A binding purchase request');
  });

  it('name wins over term when both present', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        concepts: [
          { id: 'CN001', name: 'Order', term: 'Purchase Order', description: 'Short', definition: 'Formal' },
        ],
      },
      filePath: 'concepts.yaml',
      scope: undefined,
    };
    const entities = extractConcepts(doc);
    expect(entities[0]!.term).toBe('Order');
    expect(entities[0]!.description).toBe('Short');
  });

  it('extracts actors and concepts from same doc', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        concepts: [{ id: 'CN001', term: 'Order', summary: 'Order' }],
        actors: [{ id: 'ACT001', name: 'Customer', type: 'human', summary: 'Shopper' }],
      },
      filePath: 'orders/concepts.yaml',
      scope: 'orders',
    };
    const entities = extractConcepts(doc);
    expect(entities).toHaveLength(2);
    const concept = entities.find((e) => e.type === ENTITY_TYPE.Concept);
    const actor = entities.find((e) => e.type === ENTITY_TYPE.Actor);
    expect(concept?.displayId).toBe('CN001');
    expect(actor?.displayId).toBe('ACT001');
    expect(actor?.term).toBe('Customer');
  });

  it('T03-A05: Actor with personas[] has personas array in entity.data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        actors: [
          {
            id: 'ACT001',
            name: 'Shopper',
            type: 'human',
            summary: 'Online consumer',
            personas: [
              {
                name: 'Impulse Shopper',
                quote: 'I want to find what I need quickly.',
                goals: ['Find products fast', 'Complete checkout in 2 minutes'],
                pain_points: ['Unexpected shipping costs'],
                behaviors: ['Shops on mobile'],
                tech_savviness: 'medium',
                demographics: { role: 'Online consumer', industry: 'Retail' },
              },
            ],
          },
        ],
      },
      filePath: 'orders/concepts.yaml',
      scope: 'orders',
    };
    const entities = extractConcepts(doc);
    const actor = entities.find((e) => e.type === ENTITY_TYPE.Actor);
    expect(actor).toBeDefined();
    const personas = (actor!.data as Record<string, unknown>).personas as Record<string, unknown>[];
    expect(personas).toBeDefined();
    expect(Array.isArray(personas)).toBe(true);
    expect(personas).toHaveLength(1);
    expect(personas[0]!.name).toBe('Impulse Shopper');
    expect(personas[0]!.quote).toBe('I want to find what I need quickly.');
    expect(personas[0]!.goals).toEqual(['Find products fast', 'Complete checkout in 2 minutes']);
    expect(personas[0]!.pain_points).toEqual(['Unexpected shipping costs']);
    expect(personas[0]!.tech_savviness).toBe('medium');
  });

  it('T03-A06: Actor without personas has no personas in entity.data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        actors: [
          { id: 'ACT002', name: 'Domain Lead', type: 'role', summary: 'Technical lead' },
        ],
      },
      filePath: 'orders/concepts.yaml',
      scope: 'orders',
    };
    const entities = extractConcepts(doc);
    const actor = entities.find((e) => e.type === ENTITY_TYPE.Actor);
    expect(actor).toBeDefined();
    expect((actor!.data as Record<string, unknown>).personas).toBeUndefined();
  });

  it('T03-A07: persona fields accessible via entity.data.personas[0]', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        actors: [
          {
            id: 'ACT003',
            name: 'Merchant',
            type: 'human',
            personas: [
              {
                name: 'Power Merchant',
                quote: 'I need full control.',
                goals: ['Manage catalog'],
                pain_points: ['Bulk import slow'],
                behaviors: ['Uses admin daily'],
                tech_savviness: 'high',
                demographics: { role: 'Store owner' },
              },
            ],
          },
        ],
      },
      filePath: 'orders/concepts.yaml',
      scope: 'orders',
    };
    const entities = extractConcepts(doc);
    const actor = entities.find((e) => e.type === ENTITY_TYPE.Actor);
    const personas = (actor!.data as Record<string, unknown>).personas as Record<string, unknown>[];
    expect(Array.isArray(personas)).toBe(true);
    expect(personas).toHaveLength(1);
    const persona = personas[0]!;
    expect(typeof persona.name).toBe('string');
    expect(typeof persona.quote).toBe('string');
    expect(Array.isArray(persona.goals)).toBe(true);
    expect(Array.isArray(persona.pain_points)).toBe(true);
    expect(Array.isArray(persona.behaviors)).toBe(true);
    expect(typeof persona.tech_savviness).toBe('string');
    expect(typeof persona.demographics).toBe('object');
  });

  // ---------------------------------------------------------------------
  // Phase 2 step-03 — context-link injection (`_context_name`, `_scope`)
  // ---------------------------------------------------------------------

  describe('Phase 2 step-03 — context link injection', () => {
    it('propagates doc.data.name as _context_name on every Concept', () => {
      const doc: ParsedBlueprintDocument = {
        data: {
          name: 'Klienci',
          version: '1.0.0',
          concepts: [
            { id: 'CN001', name: 'Customer', summary: 'Buyer' },
            { id: 'CN002', name: 'Address', summary: 'Place' },
          ],
        },
        filePath: 'customers/concepts.yaml',
        scope: 'customers',
      };
      const entities = extractConcepts(doc);
      expect(entities).toHaveLength(2);
      for (const e of entities) {
        const data = e.data as Record<string, unknown>;
        expect(data._context_name).toBe('Klienci');
        expect(data._scope).toBe('customers');
        // Original fields remain.
        expect(data.id).toBeDefined();
        expect(data.name).toBeDefined();
      }
    });

    it('propagates _context_name across Actor / Enumeration / Association too', () => {
      const doc: ParsedBlueprintDocument = {
        data: {
          name: 'Orders',
          version: '1.0.0',
          concepts: [{ id: 'CN001', name: 'Order' }],
          actors: [{ id: 'ACT001', name: 'Buyer', type: 'human' }],
          enumerations: [{ id: 'EN001', name: 'Status', values: ['draft', 'submitted'] }],
          associations: [{ id: 'AS001', name: 'OrderHasItems' }],
        },
        filePath: 'orders/concepts.yaml',
        scope: 'orders',
      };
      const entities = extractConcepts(doc);
      expect(entities).toHaveLength(4);
      for (const e of entities) {
        const data = e.data as Record<string, unknown>;
        expect(data._context_name, `${e.displayId} missing _context_name`).toBe('Orders');
        expect(data._scope, `${e.displayId} missing _scope`).toBe('orders');
      }
    });

    it('omits _context_name when doc.data.name is missing', () => {
      const doc: ParsedBlueprintDocument = {
        data: {
          version: '1.0.0',
          concepts: [{ id: 'CN001', name: 'Order' }],
        },
        filePath: 'concepts.yaml',
        scope: undefined,
      };
      const entities = extractConcepts(doc);
      const data = entities[0]!.data as Record<string, unknown>;
      expect('_context_name' in data).toBe(false);
      expect('_scope' in data).toBe(false);
    });

    it('does not mutate the source `concepts[]` items (clone semantics)', () => {
      const original = { id: 'CN001', name: 'Order' };
      const doc: ParsedBlueprintDocument = {
        data: { name: 'Orders', version: '1.0.0', concepts: [original] },
        filePath: 'orders/concepts.yaml',
        scope: 'orders',
      };
      extractConcepts(doc);
      expect('_context_name' in original).toBe(false);
    });
  });

  it('T03-A08: Actor with singular persona (v2.5 compat) passes through in entity.data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        actors: [
          {
            id: 'ACT004',
            name: 'Legacy User',
            type: 'human',
            summary: 'A v2.5-era actor with singular persona',
            persona: {
              quote: 'I just want it to work.',
              goals: ['Simple checkout'],
              pain_points: ['Too many steps'],
              behaviors: ['Desktop only'],
              tech_savviness: 'low',
              demographics: { role: 'Casual buyer' },
            },
          },
        ],
      },
      filePath: 'legacy/concepts.yaml',
      scope: 'legacy',
    };
    const entities = extractConcepts(doc);
    const actor = entities.find((e) => e.type === ENTITY_TYPE.Actor);
    expect(actor).toBeDefined();
    const persona = (actor!.data as Record<string, unknown>).persona as Record<string, unknown>;
    expect(persona).toBeDefined();
    expect(typeof persona).toBe('object');
    expect(persona.quote).toBe('I just want it to work.');
    expect(persona.goals).toEqual(['Simple checkout']);
  });
});
