import { describe, it, expect } from 'vitest';
import { extractArch } from './arch.js';
import { extractOrgOwnershipRelations } from '../relations/org.js';
import { extractSystemRelations } from '../relations/systemRef.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import type { Entity, ParsedBlueprintDocument } from '../../model/types.js';

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
  it.each([
    { declaredId: 'PRT014', expectedId: 'PRT014' },
    { declaredId: undefined, expectedId: 'ERP' },
  ])('preserves party identity and name with declared id $declaredId', ({ declaredId, expectedId }) => {
    const doc: ParsedBlueprintDocument = {
      filePath: 'accounting/arch.yaml',
      scope: 'accounting',
      data: {
        parties: [{ ...(declaredId ? { id: declaredId } : {}), name: 'ERP', kind: 'system', description: 'Ledger system' }],
      },
    };

    const parties = extractArch(doc);

    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({
      id: `accounting-arch.yaml-${expectedId}`,
      displayId: expectedId,
      type: ENTITY_TYPE.Party,
      term: 'ERP',
      summary: 'Ledger system',
      data: { name: 'ERP', kind: 'system', _scope: 'accounting' },
    });
  });

  it('resolves ownership and system references to an arch-declared party by id', () => {
    const doc: ParsedBlueprintDocument = {
      filePath: 'accounting/arch.yaml',
      scope: 'accounting',
      data: {
        parties: [{ id: 'PRT014', name: 'ERP', kind: 'system' }],
        contexts: [{
          name: 'Accounting', kind: 'core', owned_by: { party: 'PRT014' },
          services: [{ name: 'Ledger API', system_ref: 'PRT014' }],
        }],
      },
    };
    const entities = extractArch(doc);
    const placeholders = new Map<string, Entity>();

    const relations = [
      ...extractOrgOwnershipRelations(entities, placeholders),
      ...extractSystemRelations(entities, placeholders),
    ];

    expect(placeholders.size).toBe(0);
    expect(relations.filter(relation => relation.type === 'owned_by')).toMatchObject([
      { source_entity_id: 'accounting-arch.yaml-.Accounting', target_entity_id: 'accounting-arch.yaml-PRT014' },
    ]);
    expect(relations.filter(relation => relation.type === 'system_ref')).toMatchObject([
      { source_entity_id: 'accounting-arch.yaml-.Accounting.Ledger API', target_entity_id: 'accounting-arch.yaml-PRT014' },
    ]);
  });

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
  // `_scope` propagation onto Party/Context/Service/Contract
  // ---------------------------------------------------------------------

  describe('_scope propagation', () => {
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

describe('extractArch - the root form', () => {
  const rootDoc: ParsedBlueprintDocument = {
    filePath: 'accounting/arch.yaml',
    scope: 'accounting',
    data: {
      name: 'Accounting architecture',
      system_ref: 'PRT014',
      // A party declared whole: id, name, env, and no contexts of its own.
      parties: [{ id: 'PRT014', name: 'ERP', kind: 'system', env: 'production' }],
      contexts: [
        {
          id: 'BC001',
          name: 'Accounting',
          kind: 'core',
          services: [
            { id: 'SVC001', name: 'Ledger API', contracts: { openapi: { output: 'ledger.openapi' } } },
            { id: 'SVC002', name: 'Statements', system_ref: 'PRT019' },
          ],
        },
      ],
    },
  };

  it('emits a party declared whole, with no contexts, as a Party', () => {
    const parties = extractArch(rootDoc).filter((e) => e.type === ENTITY_TYPE.Party);
    expect(parties.map((e) => [e.displayId, e.term])).toEqual([['PRT014', 'ERP']]);
  });

  it('emits a root-declared context and everything under it with _root and no _party', () => {
    const entities = extractArch(rootDoc);
    const context = entities.find((e) => e.type === ENTITY_TYPE.Context)!;
    const services = entities.filter((e) => e.type === ENTITY_TYPE.Service);
    const contract = entities.find((e) => e.type === ENTITY_TYPE.Contract)!;

    expect(context.displayId).toBe('Accounting');
    expect(context.data).toMatchObject({ _root: true, _scope: 'accounting' });
    expect(context.data).not.toHaveProperty('_party');
    expect(services.map((e) => e.displayId)).toEqual(['Ledger API', 'Statements']);
    for (const service of services) {
      expect(service.data).toMatchObject({ _root: true, _context: 'Accounting' });
      expect(service.data).not.toHaveProperty('_party');
    }
    expect(contract.data).toMatchObject({ _root: true, _service: 'Ledger API', _context: 'Accounting' });
  });

  it('gives a root-declared context an empty party segment, which no nested path can produce', () => {
    const entities = extractArch(rootDoc);
    expect(entities.find((e) => e.type === ENTITY_TYPE.Context)!.id).toBe('accounting-arch.yaml-.Accounting');
    expect(entities.find((e) => e.displayId === 'Statements')!.id).toBe('accounting-arch.yaml-.Accounting.Statements');
    // Nested parties retain their authored ids.
    const nested = extractArch(archDoc);
    expect(nested.find((e) => e.type === ENTITY_TYPE.Context)!.id).toBe('catalog-arch.yaml-Shop.Catalog');
  });

  it('reads both shapes from one document', () => {
    const both: ParsedBlueprintDocument = {
      filePath: 'arch.yaml',
      data: {
        parties: [{ id: 'PRT001', name: 'Shop', env: 'production', contexts: [{ name: 'Catalog', kind: 'core' }] }],
        contexts: [{ id: 'BC002', name: 'Orders', kind: 'core' }],
      },
    };
    const contexts = extractArch(both).filter((e) => e.type === ENTITY_TYPE.Context);
    expect(contexts.map((e) => [e.displayId, e.data?._party ?? null, e.data?._root ?? null])).toEqual([
      ['Catalog', 'Shop', null],
      ['Orders', null, true],
    ]);
  });

  // ---------------------------------------------------------------------
  // v2.8.44 - probes are extracted as nodes
  // ---------------------------------------------------------------------

  describe('probes', () => {
    it('emits nothing new for a document that declares none', () => {
      // A probe-free model contains no probe entities.
      const before = extractArch(archDoc);
      expect(before.some((entity) => entity.type === ENTITY_TYPE.Probe)).toBe(false);
      expect(before).toHaveLength(6);
    });

    it('emits one Probe per declaration, with the blind spots carried whole', () => {
      const doc: ParsedBlueprintDocument = {
        filePath: 'integration/arch.yaml',
        scope: 'integration',
        data: {
          probes: [
            {
              id: 'PRB001',
              name: 'route coverage',
              question: 'Which endpoints does the source expose?',
              summary: 'Reads a structure index and reports endpoint coverage',
              source_kind: 'dependency index',
              attention_control: 'third-party',
              status: 'active',
              blind_spots: [
                {
                  omitted_fact: 'the route prefix declared on the controller class',
                  basis: 'observed',
                  observed_at: '2026-09-17',
                  consequence: 'a bare path reads as a root-mounted endpoint',
                },
              ],
            },
            {
              id: 'PRB002',
              name: 'space reader',
              question: 'Which pages describe this context?',
              attention_control: 'owned',
            },
          ],
        },
      };

      const probes = extractArch(doc).filter((entity) => entity.type === ENTITY_TYPE.Probe);
      expect(probes.map((entity) => entity.displayId)).toEqual(['PRB001', 'PRB002']);
      expect(probes[0]!.layer).toBe('design.arch');
      // `term` is the Name column and the field the text search ranks as a name match. Without it
      // a probe carrying no summary lists with a blank name.
      expect(probes.map((entity) => entity.term)).toEqual(['route coverage', 'space reader']);
      expect(probes[0]!.summary).toBe('Reads a structure index and reports endpoint coverage');
      expect(probes[0]!.data?.question).toBe('Which endpoints does the source expose?');
      expect(probes[0]!.data?.attention_control).toBe('third-party');
      // Whole, not summarised: a reader weighing an omission needs its basis and its date.
      expect(probes[0]!.data?.blind_spots).toEqual([
        {
          omitted_fact: 'the route prefix declared on the controller class',
          basis: 'observed',
          observed_at: '2026-09-17',
          consequence: 'a bare path reads as a root-mounted endpoint',
        },
      ]);
      expect(probes[1]!.data?.blind_spots).toBeUndefined();
    });

    it('takes neither the party nor the context segment in its internal id', () => {
      const doc: ParsedBlueprintDocument = {
        filePath: 'integration/arch.yaml',
        scope: 'integration',
        data: {
          parties: [{ name: 'Shop', contexts: [{ name: 'Catalog', kind: 'core' }] }],
          probes: [{ id: 'PRB001', name: 'route coverage', question: 'Which endpoints?' }],
        },
      };
      const probe = extractArch(doc).find((entity) => entity.type === ENTITY_TYPE.Probe);
      expect(probe?.id).toBe('integration-arch.yaml-PRB001');
    });

    it('carries the document scope, and skips a declaration with no id', () => {
      const doc: ParsedBlueprintDocument = {
        filePath: 'integration/arch.yaml',
        scope: 'integration',
        data: {
          probes: [
            { id: 'PRB001', name: 'route coverage', question: 'Which endpoints?' },
            { name: 'nameless', question: 'Which endpoints?' },
          ],
        },
      };
      const probes = extractArch(doc).filter((entity) => entity.type === ENTITY_TYPE.Probe);
      expect(probes).toHaveLength(1);
      expect(probes[0]!.data?._scope).toBe('integration');
    });
  });
});

describe('extractArch: third-party packages (v2.8.84)', () => {
  const packageDoc: ParsedBlueprintDocument = {
    filePath: 'platform/arch.yaml',
    scope: 'platform',
    data: {
      version: '1.0.0',
      name: 'Platform packages',
      packages: [
        {
          id: 'platform.PKG002',
          name: 'yaml',
          summary: 'Parses YAML.',
          ecosystem: 'npm',
          version: '2.8.1',
          license: { expression: 'ISC' },
        },
        { id: 'platform.PKG004', name: 'lodash' },
        { name: 'no id, so no address' },
      ],
    },
  };

  it('emits one Package per declared id, addressed by that id, with its name as the term', () => {
    const packages = extractArch(packageDoc).filter((entity) => entity.type === ENTITY_TYPE.Package);
    expect(packages.map((entity) => [entity.displayId, entity.term, entity.layer])).toEqual([
      ['platform.PKG002', 'yaml', 'design.arch'],
      ['platform.PKG004', 'lodash', 'design.arch'],
    ]);
    expect(packages[0]!.summary).toBe('Parses YAML.');
    expect(packages[0]!.id).not.toBe(packages[1]!.id);
  });

  it('carries what the declaration states and invents nothing it omits', () => {
    const [stated, bare] = extractArch(packageDoc).filter((entity) => entity.type === ENTITY_TYPE.Package);
    expect(stated!.data).toEqual({ ...packageDoc.data.packages[0], _scope: 'platform' });
    expect(bare!.data).toEqual({ id: 'platform.PKG004', name: 'lodash', _scope: 'platform' });
    expect(bare!.summary).toBeUndefined();
  });

  it('emits packages beside the parties, contexts and services of a mixed document', () => {
    const mixed: ParsedBlueprintDocument = {
      ...archDoc,
      data: { ...archDoc.data, packages: [{ id: 'catalog.PKG001', name: 'DocumentToolkit' }] },
    };
    const types = extractArch(mixed).map((entity) => entity.type);
    expect(types.filter((type) => type === ENTITY_TYPE.Package)).toHaveLength(1);
    expect(types).toEqual([...extractArch(archDoc).map((entity) => entity.type), ENTITY_TYPE.Package]);
  });
});
