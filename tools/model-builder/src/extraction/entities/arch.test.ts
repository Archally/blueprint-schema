import { describe, it, expect } from 'vitest';
import { extractArch } from './arch.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';

const archDoc: ParsedBlueprintDocument = {
  filePath: 'catalog/arch.yaml',
  scope: 'catalog',
  data: {
    version: '1.0.0',
    name: 'E-Shop',
    parties: [
      {
        name: 'Shop',
        kind: 'system',
        env: 'production',
        contexts: [
          {
            name: 'Catalog',
            kind: 'core',
            summary: 'Product catalog',
            services: [
              {
                name: 'ProductQueryService',
                kind: 'api',
                summary: 'Serves products',
                contracts: {
                  openapi: { output: 'dist/openapi.json' },
                },
              },
            ],
          },
          {
            name: 'Orders',
            kind: 'core',
            summary: 'Order lifecycle',
            services: [
              { name: 'OrderService', kind: 'api', summary: 'Manages orders' },
            ],
          },
        ],
      },
    ],
  },
};

describe('extractArch', () => {
  it('extracts Context, Service, and Contract entities from array-format arch doc', () => {
    const entities = extractArch(archDoc);

    const contexts = entities.filter((e) => e.type === ENTITY_TYPE.Context);
    const services = entities.filter((e) => e.type === ENTITY_TYPE.Service);
    const contracts = entities.filter((e) => e.type === ENTITY_TYPE.Contract);

    expect(contexts).toHaveLength(2);
    expect(services).toHaveLength(2);
    expect(contracts).toHaveLength(1);
  });

  it('assigns layer design.arch to all entities', () => {
    const entities = extractArch(archDoc);
    expect(entities.every((e) => e.layer === 'design.arch')).toBe(true);
  });

  it('sets displayId to the context/service/contract name', () => {
    const entities = extractArch(archDoc);

    const catalog = entities.find((e) => e.type === ENTITY_TYPE.Context && e.displayId === 'Catalog');
    expect(catalog).toBeDefined();
    expect(catalog?.summary).toBe('Product catalog');

    const productSvc = entities.find((e) => e.type === ENTITY_TYPE.Service && e.displayId === 'ProductQueryService');
    expect(productSvc).toBeDefined();
    expect(productSvc?.data?._context).toBe('Catalog');
    expect(productSvc?.data?._party).toBe('Shop');

    const contract = entities.find((e) => e.type === ENTITY_TYPE.Contract);
    expect(contract?.displayId).toBe('ProductQueryService.openapi');
    expect(contract?.data?._contractType).toBe('openapi');
    expect(contract?.data?._service).toBe('ProductQueryService');
  });

  it('generates deterministic unique IDs using qualified party.context[.service] path', () => {
    const entities = extractArch(archDoc);

    const catalog = entities.find((e) => e.type === ENTITY_TYPE.Context && e.displayId === 'Catalog');
    const orders = entities.find((e) => e.type === ENTITY_TYPE.Context && e.displayId === 'Orders');
    expect(catalog?.id).toBe('catalog-arch.yaml-Shop.Catalog');
    expect(orders?.id).toBe('catalog-arch.yaml-Shop.Orders');

    const productSvc = entities.find((e) => e.type === ENTITY_TYPE.Service && e.displayId === 'ProductQueryService');
    expect(productSvc?.id).toBe('catalog-arch.yaml-Shop.Catalog.ProductQueryService');
  });

  it('returns empty array for doc without parties', () => {
    const doc: ParsedBlueprintDocument = { data: {}, filePath: 'x/arch.yaml' };
    expect(extractArch(doc)).toEqual([]);
  });

  it('skips parties or contexts missing a name', () => {
    const doc: ParsedBlueprintDocument = {
      filePath: 'x/arch.yaml',
      scope: 'x',
      data: {
        parties: [
          { contexts: [{ name: 'Orphan', kind: 'core', services: [] }] },
          { name: 'Valid', contexts: [] },
        ],
      },
    };
    const entities = extractArch(doc);
    // First party has no name → skipped. Second emits a Party entity but no
    // Context/Service (empty contexts array). Total: 1 Party entity.
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe(ENTITY_TYPE.Party);
    expect(entities[0].displayId).toBe('Valid');
  });

  it('emits Party entity for parties with empty contexts (DQ-ARCH-16)', () => {
    const doc: ParsedBlueprintDocument = {
      filePath: 'x/arch.yaml',
      scope: 'x',
      data: {
        parties: [
          {
            name: 'CRM',
            kind: 'system',
            env: 'production',
            description: 'External CRM system',
            contexts: [],
          },
        ],
      },
    };
    const entities = extractArch(doc);
    const party = entities.find(entity => entity.type === ENTITY_TYPE.Party);
    expect(party).toBeDefined();
    expect(party?.displayId).toBe('CRM');
    expect(party?.summary).toBe('External CRM system');
    expect(party?.data?.kind).toBe('system');
    expect(party?.data?.env).toBe('production');
  });

  // ---------------------------------------------------------------------
  // Phase 2 step-03 — `_scope` propagation onto Party/Context/Service/Contract
  // ---------------------------------------------------------------------

  describe('Phase 2 step-03 — _scope propagation', () => {
    it('propagates doc.scope as _scope onto Context, Service, and Contract entities', () => {
      const doc: ParsedBlueprintDocument = {
        filePath: 'customers/arch.yaml',
        scope: 'customers',
        data: {
          name: 'Klienci',
          parties: [
            {
              name: 'Portal Klienta',
              kind: 'system',
              contexts: [
                {
                  name: 'Klienci',
                  kind: 'core',
                  services: [
                    {
                      name: 'CustomerFacade',
                      contracts: {
                        asyncapi: { output: 'cf.asyncapi', send: ['customers.EVT001'] },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      const entities = extractArch(doc);
      const party = entities.find((e) => e.type === ENTITY_TYPE.Party);
      const context = entities.find((e) => e.type === ENTITY_TYPE.Context);
      const service = entities.find((e) => e.type === ENTITY_TYPE.Service);
      const contract = entities.find((e) => e.type === ENTITY_TYPE.Contract);
      expect((party!.data as Record<string, unknown>)._scope).toBe('customers');
      expect((context!.data as Record<string, unknown>)._scope).toBe('customers');
      expect((service!.data as Record<string, unknown>)._scope).toBe('customers');
      expect((contract!.data as Record<string, unknown>)._scope).toBe('customers');
    });

    it('omits _scope when doc.scope is undefined', () => {
      const doc: ParsedBlueprintDocument = {
        filePath: 'arch.yaml',
        scope: undefined,
        data: {
          parties: [
            { name: 'Org', kind: 'organization', contexts: [{ name: 'Sales', kind: 'core' }] },
          ],
        },
      };
      const entities = extractArch(doc);
      for (const e of entities) {
        const data = e.data as Record<string, unknown>;
        expect('_scope' in data).toBe(false);
      }
    });

    it('does not mutate source party / context objects', () => {
      const ctx = { name: 'Klienci', kind: 'core' };
      const party = { name: 'P', kind: 'system', contexts: [ctx] };
      const doc: ParsedBlueprintDocument = {
        filePath: 'customers/arch.yaml',
        scope: 'customers',
        data: { parties: [party] },
      };
      extractArch(doc);
      expect('_scope' in party).toBe(false);
      expect('_scope' in ctx).toBe(false);
    });
  });
});
