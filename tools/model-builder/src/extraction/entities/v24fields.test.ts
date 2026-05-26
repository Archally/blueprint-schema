import { describe, it, expect } from 'vitest';
import { extractConcepts } from './concepts.js';
import { extractArch } from './arch.js';
import { extractModels } from './models.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('v2.4 field extraction — concepts', () => {
  it('T03-01: concept with stereotype is stored in data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        concepts: [
          { id: 'CN001', name: 'Order', stereotype: 'aggregate-root' },
          { id: 'CN002', name: 'LineItem', stereotype: 'entity' },
          { id: 'CN003', name: 'Money', stereotype: 'value-object' },
        ],
      },
      filePath: 'orders/concepts.yaml',
      scope: 'orders',
    };
    const entities = extractConcepts(doc);
    expect(entities).toHaveLength(3);

    const order = entities.find((e) => e.displayId === 'CN001')!;
    expect((order.data as Record<string, unknown>).stereotype).toBe('aggregate-root');

    const lineItem = entities.find((e) => e.displayId === 'CN002')!;
    expect((lineItem.data as Record<string, unknown>).stereotype).toBe('entity');

    const money = entities.find((e) => e.displayId === 'CN003')!;
    expect((money.data as Record<string, unknown>).stereotype).toBe('value-object');
  });

  it('T03-02: concept with code_refs is stored in data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        concepts: [
          {
            id: 'CN001',
            name: 'Order',
            code_refs: [
              { path: 'src/domain/Order.ts', role: 'model', line: 10 },
              { path: 'src/domain/Order.test.ts', role: 'test' },
            ],
          },
        ],
      },
      filePath: 'orders/concepts.yaml',
      scope: 'orders',
    };
    const entities = extractConcepts(doc);
    expect(entities).toHaveLength(1);
    const data = entities[0]!.data as Record<string, unknown>;
    expect(data.code_refs).toEqual([
      { path: 'src/domain/Order.ts', role: 'model', line: 10 },
      { path: 'src/domain/Order.test.ts', role: 'test' },
    ]);
  });
});

describe('v2.4 field extraction — arch', () => {
  it('T03-06: service with servers is stored in data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'TestSystem',
        parties: [
          {
            name: 'System',
            env: 'production',
            contexts: [
              {
                name: 'Orders',
                kind: 'core',
                services: [
                  {
                    name: 'OrderAPI',
                    kind: 'api',
                    servers: [
                      { url: 'https://api.example.com/v1', environment: 'production' },
                      { url: 'https://staging.example.com/v1', environment: 'staging' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      filePath: 'arch.yaml',
      scope: 'default',
    };
    const entities = extractArch(doc);
    const service = entities.find((e) => e.type === ENTITY_TYPE.Service)!;
    expect(service).toBeDefined();
    const data = service.data as Record<string, unknown>;
    expect(data.servers).toEqual([
      { url: 'https://api.example.com/v1', environment: 'production' },
      { url: 'https://staging.example.com/v1', environment: 'staging' },
    ]);
  });

  it('T03-07: graphql contract is stored in service data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'TestSystem',
        parties: [
          {
            name: 'System',
            env: 'production',
            contexts: [
              {
                name: 'Shop',
                kind: 'core',
                services: [
                  {
                    name: 'ShopGQL',
                    kind: 'api',
                    contracts: {
                      graphql: {
                        output: 'generated/schema.graphql',
                        queries: ['getProducts', 'getOrders'],
                        mutations: ['createOrder'],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      filePath: 'arch.yaml',
    };
    const entities = extractArch(doc);
    const contract = entities.find((e) => e.type === ENTITY_TYPE.Contract)!;
    expect(contract).toBeDefined();
    const data = contract.data as Record<string, unknown>;
    expect(data._contractType).toBe('graphql');
    const contractObj = data as Record<string, unknown>;
    expect(contractObj.output).toBe('generated/schema.graphql');
    expect(contractObj.queries).toEqual(['getProducts', 'getOrders']);
  });
});

describe('v2.4 field extraction — models', () => {
  it('T03-08: model with compatibility is stored in data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        components: {
          schemas: {
            OrderCreated: {
              'x-model-id': 'MDL001',
              type: 'object',
              description: 'Order created event payload',
              compatibility: 'backward',
            },
            OrderCancelled: {
              'x-model-id': 'MDL002',
              type: 'object',
              compatibility: 'full',
            },
          },
        },
      },
      filePath: 'orders/models.yaml',
      scope: 'orders',
    };
    const entities = extractModels(doc);
    expect(entities).toHaveLength(2);

    const mdl1 = entities.find((e) => e.displayId === 'MDL001')!;
    expect((mdl1.data as Record<string, unknown>).compatibility).toBe('backward');

    const mdl2 = entities.find((e) => e.displayId === 'MDL002')!;
    expect((mdl2.data as Record<string, unknown>).compatibility).toBe('full');
  });
});
