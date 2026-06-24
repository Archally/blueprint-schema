import { describe, it, expect } from 'vitest';
import { buildBlueprintModel, groupDocumentsBySchemaType } from './buildModel.js';
import type { ParsedBlueprintDocument } from './types.js';
import { ENTITY_TYPE } from './entityTypes.js';

describe('buildBlueprintModel', () => {
  it('merges same-name parties declared across multiple arch files', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: {
          version: '1.0.0',
          name: 'Shop',
          parties: [{ name: 'Shop', env: 'prod', contexts: [{ name: 'Catalog', summary: 'Products' }] }],
        },
        filePath: 'catalog.arch.yaml',
      },
      {
        data: {
          version: '1.0.0',
          name: 'Shop',
          parties: [{ name: 'Shop', env: 'prod', contexts: [{ name: 'Checkout', summary: 'Cart + payment' }] }],
        },
        filePath: 'checkout.arch.yaml',
      },
    ];
    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));
    const parties = model.entities.filter((e) => e.type === ENTITY_TYPE.Party);
    expect(parties).toHaveLength(1);
    expect(parties[0]!.displayId).toBe('Shop');
    const ctxNames = ((parties[0]!.data?.contexts as Array<{ name: string }>) ?? []).map((c) => c.name);
    expect(ctxNames).toEqual(['Catalog', 'Checkout']);
    // both contexts are still emitted as their own entities
    expect(
      model.entities
        .filter((e) => e.type === ENTITY_TYPE.Context)
        .map((e) => e.displayId)
        .sort()
    ).toEqual(['Catalog', 'Checkout']);
  });

  it('builds Context->Context depends_on relations from dependencies[]', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: {
          version: '1.0.0',
          name: 'Shop',
          parties: [
            {
              name: 'Shop',
              env: 'prod',
              contexts: [
                {
                  name: 'Checkout',
                  summary: 'Cart',
                  dependencies: [
                    { name: 'Catalog', type: 'api', relationship: 'customer-supplier', direction: 'downstream' },
                  ],
                },
                { name: 'Catalog', summary: 'Products' },
              ],
            },
          ],
        },
        filePath: 'shop.arch.yaml',
      },
    ];
    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));
    const checkout = model.entities.find((e) => e.type === ENTITY_TYPE.Context && e.displayId === 'Checkout')!;
    const catalog = model.entities.find((e) => e.type === ENTITY_TYPE.Context && e.displayId === 'Catalog')!;
    const dep = model.relations.find(
      (r) => r.type === 'depends_on' && r.source_entity_id === checkout.id && r.target_entity_id === catalog.id
    );
    expect(dep).toBeDefined();
    expect(dep!.data?.relationship).toBe('customer-supplier');
  });

  it('returns entities and metadata; full build on small example has expected counts per layer', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: {
          version: '1.0.0',
          concepts: [{ id: 'CN001', term: 'Product', summary: 'Sellable item' }],
          actors: [{ id: 'ACT001', name: 'Customer', type: 'human', summary: 'Shopper' }],
        },
        filePath: 'catalog/concepts.yaml',
        scope: 'catalog',
      },
      {
        data: {
          version: '1.0.0',
          name: 'Catalog',
          description: 'Catalog context handles product information.',
          operations: {
            'op.get_product': { id: 'OP001', kind: 'query', name: 'Get Product', exchange: { protocol: 'http', endpoint: { path: '/products', method: 'GET', group: 'catalog' } } },
          },
        },
        filePath: 'catalog/domain.yaml',
        scope: 'catalog',
      },
      {
        data: {
          version: '1.0.0',
          structural: [{ id: 'SR001', name: 'Order has items', summary: 'Required', logic: { then: 'true' }, modality: 'necessary', concepts: ['CN001'] }],
          transition: [{ id: 'TR001', name: 'Submit', concept: 'CN001', from: 'draft', to: 'submitted', guard: {} }],
        },
        filePath: 'orders/rules.yaml',
        scope: 'orders',
      },
      {
        data: {
          version: '1.0.0',
          goals: [{ id: 'G001', statement: 'Process fast', priority: 'high' }],
        },
        filePath: 'orders/motivation.yaml',
        scope: 'orders',
      },
      {
        data: {
          version: '1.0.0',
          happy_path: [{ id: 'TC001', name: 'Submit valid order', summary: 'OK', validates: { rules: ['SR001'], operations: ['OP001'] } }],
        },
        filePath: 'orders/test-cases.yaml',
        scope: 'orders',
      },
    ];

    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));

    expect(model.entities.length).toBeGreaterThan(0);
    expect(model.metadata.files).toHaveLength(5);
    expect(model.metadata.total_entities).toBe(model.entities.length);
    expect(model.metadata.total_relations).toBe(model.relations.length);
    expect(model.metadata.domain_descriptions?.catalog).toContain(
      'Catalog context handles product information.'
    );
    // Relations are extracted from step-04 onwards; expect at least rule→concept and test→rule
    expect(model.relations.length).toBeGreaterThan(0);

    const concepts = model.entities.filter((e) => e.type === ENTITY_TYPE.Concept);
    const actors = model.entities.filter((e) => e.type === ENTITY_TYPE.Actor);
    const operations = model.entities.filter((e) => e.type === ENTITY_TYPE.Operation);
    const structural = model.entities.filter((e) => e.type === ENTITY_TYPE.StructuralRule);
    const transition = model.entities.filter((e) => e.type === ENTITY_TYPE.TransitionRule);
    const goals = model.entities.filter((e) => e.type === ENTITY_TYPE.Goal);
    const testCases = model.entities.filter((e) => e.type === ENTITY_TYPE.TestCase);

    expect(concepts).toHaveLength(1);
    expect(actors).toHaveLength(1);
    expect(operations).toHaveLength(1);
    expect(structural).toHaveLength(1);
    expect(transition).toHaveLength(1);
    expect(goals).toHaveLength(1);
    expect(testCases).toHaveLength(1);

    expect(concepts[0]!.layer).toBe('design.concepts');
    expect(operations[0]!.layer).toBe('design.domain');
    expect(structural[0]!.layer).toBe('design.rules');
    expect(goals[0]!.layer).toBe('governance.motivation');
    expect(testCases[0]!.layer).toBe('governance.tests');
    expect(testCases[0]!.data?.suite).toBe('happy_path');
  });

  it('groups same-type documents so entities from both are in the model', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: { concepts: [{ id: 'CN001', term: 'Order' }] },
        filePath: 'domain-a/concepts.yaml',
        scope: 'domain-a',
      },
      {
        data: { concepts: [{ id: 'CN001', term: 'Invoice' }] },
        filePath: 'domain-b/concepts.yaml',
        scope: 'domain-b',
      },
    ];

    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));

    expect(model.entities).toHaveLength(2);
    const fromA = model.entities.find((e) => e.fileOrigin?.includes('domain-a'));
    const fromB = model.entities.find((e) => e.fileOrigin?.includes('domain-b'));
    expect(fromA?.term).toBe('Order');
    expect(fromB?.term).toBe('Invoice');
    expect(fromA?.id).not.toBe(fromB?.id);
  });

  it('concatenates multiple domain descriptions in path order', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: { version: '1.0.0', name: 'Orders', description: 'Second description.' },
        filePath: 'orders/z.domain.yaml',
        scope: 'orders',
      },
      {
        data: { version: '1.0.0', name: 'Orders', description: 'First description.' },
        filePath: 'orders/a.domain.yaml',
        scope: 'orders',
      },
    ];

    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));
    expect(model.metadata.domain_descriptions?.orders).toBe(
      'First description.\n\nSecond description.'
    );
  });
});
