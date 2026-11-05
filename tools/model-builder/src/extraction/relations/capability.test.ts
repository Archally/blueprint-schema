import { describe, it, expect } from 'vitest';
import { extractCapabilityOperationRelations, extractCapabilityRelations } from './capability.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'governance.capability',
    fileOrigin: 'capability.yaml',
    ...overrides,
  };
}

const GOAL = makeEntity({
  id: 'default-motivation.yaml-G001',
  displayId: 'G001',
  type: ENTITY_TYPE.Goal,
  layer: 'governance.motivation',
  fileOrigin: 'motivation.yaml',
});

describe('extractCapabilityRelations - CapabilityGoal', () => {
  it('T03-A14: capability.goal_refs produce CapabilityGoal relations', () => {
    const capability = makeEntity({
      id: 'default-capability.yaml-CAP001',
      displayId: 'CAP001',
      type: ENTITY_TYPE.Capability,
      data: { id: 'CAP001', name: 'Order Management', goal_refs: ['G001'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractCapabilityRelations([capability, GOAL], placeholders);
    const goalRels = relations.filter((r) => r.type === RELATION_TYPE.CapabilityGoal);
    expect(goalRels).toHaveLength(1);
    expect(goalRels[0]!.source_entity_id).toBe(capability.id);
    expect(goalRels[0]!.target_entity_id).toBe(GOAL.id);
  });

  it('T03-A15: capability without goal_refs produces no CapabilityGoal', () => {
    const capability = makeEntity({
      id: 'default-capability.yaml-CAP002',
      displayId: 'CAP002',
      type: ENTITY_TYPE.Capability,
      data: { id: 'CAP002', name: 'Stock Reservation' },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractCapabilityRelations([capability], placeholders);
    expect(relations).toHaveLength(0);
  });
});

// ── realized_in and the effective capability -> operation attribution ─────────────────────────────

const DMN001 = makeEntity({ id: 'blueprint-DMN001', displayId: 'DMN001', type: ENTITY_TYPE.Domain, layer: 'blueprint', fileOrigin: 'blueprint.yaml', data: { id: 'DMN001', name: 'sales' } });
const DMN002 = makeEntity({ id: 'blueprint-DMN002', displayId: 'DMN002', type: ENTITY_TYPE.Domain, layer: 'blueprint', fileOrigin: 'blueprint.yaml', data: { id: 'DMN002', name: 'billing' } });
const ORDERS = makeEntity({ id: 'orders-arch.yaml-.Orders', displayId: 'Orders', type: ENTITY_TYPE.Context, layer: 'design.arch', fileOrigin: 'orders/arch.yaml', data: { id: 'BC001', name: 'Orders' } });
const BILLING = makeEntity({ id: 'billing-arch.yaml-.Billing', displayId: 'Billing', type: ENTITY_TYPE.Context, layer: 'design.arch', fileOrigin: 'billing/arch.yaml', data: { id: 'billing.BC002', name: 'Billing' } });
const PAYMENTS = makeEntity({ id: 'billing-arch.yaml-.Payments', displayId: 'Payments', type: ENTITY_TYPE.Context, layer: 'design.arch', fileOrigin: 'billing/arch.yaml', data: { id: 'billing.BC003', name: 'Payments' } });

const operation = (displayId: string) =>
  makeEntity({ id: `${displayId.split('.')[0]}-domain.yaml-${displayId}`, displayId, type: ENTITY_TYPE.Operation, layer: 'design.domain', fileOrigin: `${displayId.split('.')[0]}/domain.yaml`, data: {} });
const PLACE = operation('orders.CMD001');
const CANCEL = operation('orders.CMD002');
const RETURN = operation('orders.CMD003');
const CHARGE = operation('billing.CMD001');

const edge = (source: Entity, type: string, target: Entity) => ({
  id: `${source.id}--${type}--${target.id}`,
  source_entity_id: source.id,
  target_entity_id: target.id,
  type,
});

/** Orders' three operations sit in DMN001 and are handled by BC001; the charge is DMN002 and billing.BC002. */
const BINDING = [
  edge(PLACE, RELATION_TYPE.OperationInDomain, DMN001),
  edge(CANCEL, RELATION_TYPE.OperationInDomain, DMN001),
  edge(RETURN, RELATION_TYPE.OperationInDomain, DMN001),
  edge(CHARGE, RELATION_TYPE.OperationInDomain, DMN002),
  edge(PLACE, RELATION_TYPE.HandledBy, ORDERS),
  edge(CANCEL, RELATION_TYPE.HandledBy, ORDERS),
  edge(RETURN, RELATION_TYPE.HandledBy, ORDERS),
  edge(CHARGE, RELATION_TYPE.HandledBy, BILLING),
];

const MODULES = [DMN001, DMN002, ORDERS, BILLING, PAYMENTS, PLACE, CANCEL, RETURN, CHARGE];

const capability = (displayId: string, data: Record<string, unknown>) =>
  makeEntity({ id: `default-capability.yaml-${displayId}`, displayId, type: ENTITY_TYPE.Capability, data: { id: displayId, name: displayId, level: 1, ...data } });

/** The capability_operation edges as `CAP -> operation (origin[, module, kind, modules])`, sorted. */
function attribution(capabilities: Entity[], extra: Entity[] = [], relations = BINDING) {
  const entities = [...MODULES, ...extra, ...capabilities];
  const placeholders = new Map<string, Entity>();
  const result = extractCapabilityOperationRelations(entities, relations, placeholders);
  const name = (id: string) => entities.find((e) => e.id === id)?.displayId ?? placeholders.get(id)?.displayId ?? id;
  return {
    relations: result,
    placeholders,
    lines: result.map((r) => {
      const data = r.data as { origin: string; module?: string; module_kind?: string; modules?: string[] };
      const via = data.origin === 'module' ? ` ${data.module} ${data.module_kind} [${data.modules!.join(',')}]` : '';
      return `${name(r.source_entity_id)} -> ${name(r.target_entity_id)} ${data.origin}${via}`;
    }).sort(),
  };
}

describe('extractCapabilityRelations - CapabilityRealizedIn', () => {
  it('names a domain, a bounded context and a prefixed bounded context by their declared ids', () => {
    const cap = capability('CAP001', { realized_in: ['DMN001', 'BC001', 'billing.BC002'] });
    const relations = extractCapabilityRelations([...MODULES, cap], new Map());
    expect(relations.filter((r) => r.type === RELATION_TYPE.CapabilityRealizedIn).map((r) => r.target_entity_id).sort())
      .toEqual([BILLING.id, DMN001.id, ORDERS.id].sort());
  });

  it('an id nothing declares points at a Missing placeholder, and a context name does not stand in for its id', () => {
    const placeholders = new Map<string, Entity>();
    const cap = capability('CAP001', { realized_in: ['BC009', 'Orders'] });
    const relations = extractCapabilityRelations([...MODULES, cap], placeholders);
    expect(relations.map((r) => r.target_entity_id).sort()).toEqual(['missing-BC009', 'missing-Orders']);
    expect([...placeholders.keys()].sort()).toEqual(['missing-BC009', 'missing-Orders']);
  });
});

describe('extractCapabilityOperationRelations - stated listings', () => {
  it('a model that states no realized_in gets exactly its listings, origin operation', () => {
    const { lines } = attribution([
      capability('CAP001', { operations: ['orders.CMD001', 'orders.CMD002', 'orders.CMD001'] }),
      capability('CAP002', { operations: ['orders.CMD002'] }),
    ]);
    expect(lines).toEqual([
      'CAP001 -> orders.CMD001 operation',
      'CAP001 -> orders.CMD002 operation',
      'CAP002 -> orders.CMD002 operation',
    ]);
  });

  it('an unresolved listing keeps an edge to a placeholder and suppresses no module default', () => {
    const { lines, placeholders } = attribution([
      capability('CAP001', { realized_in: ['DMN001'] }),
      capability('CAP002', { operations: ['orders.CMD009'] }),
    ]);
    expect([...placeholders.keys()]).toEqual(['missing-orders-CMD009']);
    expect(lines).toEqual([
      'CAP001 -> orders.CMD001 module DMN001 domain [DMN001]',
      'CAP001 -> orders.CMD002 module DMN001 domain [DMN001]',
      'CAP001 -> orders.CMD003 module DMN001 domain [DMN001]',
      'CAP002 -> orders.CMD009 operation',
    ]);
  });

  it('an ambiguous listing names its candidates on the placeholder and suppresses neither candidate', () => {
    const twin = makeEntity({ ...RETURN, id: 'returns-domain.yaml-orders.CMD003', fileOrigin: 'returns/domain.yaml' });
    const relations = [...BINDING, edge(twin, RELATION_TYPE.OperationInDomain, DMN001)];
    const { lines, placeholders } = attribution(
      [capability('CAP001', { realized_in: ['DMN001'] }), capability('CAP002', { operations: ['orders.CMD003'] })],
      [twin],
      relations,
    );
    expect(placeholders.get('missing-orders-CMD003')?.data).toMatchObject({ ambiguous: true });
    expect(lines.filter((line) => line.startsWith('CAP001')).length).toBe(4);
    expect(lines).toContain('CAP002 -> orders.CMD003 operation');
  });

  it('an empty operations list states nothing and suppresses nothing', () => {
    const { lines } = attribution([capability('CAP001', { realized_in: ['BC001'], operations: [] })]);
    expect(lines).toEqual([
      'CAP001 -> orders.CMD001 module BC001 context [BC001]',
      'CAP001 -> orders.CMD002 module BC001 context [BC001]',
      'CAP001 -> orders.CMD003 module BC001 context [BC001]',
    ]);
  });
});

describe('extractCapabilityOperationRelations - module defaults and precedence', () => {
  it('a domain default attributes every operation whose document names the domain', () => {
    const { lines } = attribution([capability('CAP001', { realized_in: ['DMN002'] })]);
    expect(lines).toEqual(['CAP001 -> billing.CMD001 module DMN002 domain [DMN002]']);
  });

  it('a context default attributes every operation the context handles, prefixed id included', () => {
    const { lines } = attribution([capability('CAP001', { realized_in: ['billing.BC002'] })]);
    expect(lines).toEqual(['CAP001 -> billing.CMD001 module billing.BC002 context [billing.BC002]']);
  });

  it('a split module: the listed operation leaves the default capability and reaches only the listing one', () => {
    const { lines } = attribution([
      capability('CAP001', { realized_in: ['BC001'] }),
      capability('CAP002', { operations: ['orders.CMD003'] }),
    ]);
    expect(lines).toEqual([
      'CAP001 -> orders.CMD001 module BC001 context [BC001]',
      'CAP001 -> orders.CMD002 module BC001 context [BC001]',
      'CAP002 -> orders.CMD003 operation',
    ]);
  });

  it('a listing suppresses the default model-wide, even from a capability whose modules are unrelated', () => {
    const { lines } = attribution([
      capability('CAP001', { realized_in: ['DMN001'] }),
      capability('CAP002', { realized_in: ['billing.BC002'], operations: ['orders.CMD003'] }),
    ]);
    expect(lines).toEqual([
      'CAP001 -> orders.CMD001 module DMN001 domain [DMN001]',
      'CAP001 -> orders.CMD002 module DMN001 domain [DMN001]',
      'CAP002 -> billing.CMD001 module billing.BC002 context [billing.BC002]',
      'CAP002 -> orders.CMD003 operation',
    ]);
  });

  it('two capabilities naming one module both derive its operations', () => {
    const { lines } = attribution([
      capability('CAP001', { realized_in: ['DMN002'] }),
      capability('CAP002', { realized_in: ['billing.BC002'] }),
    ]);
    expect(lines).toEqual([
      'CAP001 -> billing.CMD001 module DMN002 domain [DMN002]',
      'CAP002 -> billing.CMD001 module billing.BC002 context [billing.BC002]',
    ]);
  });

  it('a parent and its child naming one module both derive, with no inheritance either way', () => {
    const parent = capability('CAP001', { realized_in: ['DMN002'], children: [{ id: 'CAP002' }] });
    const child = capability('CAP002', { level: 2, realized_in: ['DMN002'] });
    const lonelyChild = capability('CAP003', { level: 2 });
    const { lines } = attribution([parent, child, lonelyChild]);
    expect(lines).toEqual([
      'CAP001 -> billing.CMD001 module DMN002 domain [DMN002]',
      'CAP002 -> billing.CMD001 module DMN002 domain [DMN002]',
    ]);
  });

  it("a parent's listing suppresses its child's module default for that operation", () => {
    const { lines } = attribution([
      capability('CAP001', { operations: ['orders.CMD001'] }),
      capability('CAP002', { level: 2, realized_in: ['DMN001'] }),
    ]);
    expect(lines).toEqual([
      'CAP001 -> orders.CMD001 operation',
      'CAP002 -> orders.CMD002 module DMN001 domain [DMN001]',
      'CAP002 -> orders.CMD003 module DMN001 domain [DMN001]',
    ]);
  });

  it('a pair reached through a domain and a context is one edge naming both, the first by declared id', () => {
    const { lines } = attribution([capability('CAP001', { realized_in: ['DMN002', 'billing.BC002'] })]);
    expect(lines).toEqual(['CAP001 -> billing.CMD001 module DMN002 domain [DMN002,billing.BC002]']);
  });

  it('an operation handled by two named contexts is one edge listing both', () => {
    const relations = [...BINDING, edge(CHARGE, RELATION_TYPE.HandledBy, PAYMENTS)];
    const { lines } = attribution([capability('CAP001', { realized_in: ['billing.BC003', 'billing.BC002'] })], [], relations);
    expect(lines).toEqual(['CAP001 -> billing.CMD001 module billing.BC002 context [billing.BC002,billing.BC003]']);
  });

  it('the output does not depend on the order of entities or relations', () => {
    const capabilities = [
      capability('CAP001', { realized_in: ['DMN001', 'BC001'] }),
      capability('CAP002', { realized_in: ['billing.BC002'], operations: ['orders.CMD003', 'billing.CMD001'] }),
      capability('CAP003', { realized_in: ['DMN002'] }),
    ];
    const canonical = (entities: Entity[], relations: typeof BINDING) =>
      JSON.stringify(extractCapabilityOperationRelations(entities, relations, new Map()));
    const forward = canonical([...MODULES, ...capabilities], BINDING);
    const reversed = canonical([...capabilities, ...MODULES].reverse(), [...BINDING].reverse());
    const rotated = canonical([...MODULES.slice(4), ...capabilities.slice(1), ...MODULES.slice(0, 4), capabilities[0]!], [...BINDING.slice(3), ...BINDING.slice(0, 3)]);
    expect(reversed).toBe(forward);
    expect(rotated).toBe(forward);
    expect(JSON.parse(forward).map((r: { id: string }) => r.id)).toEqual(
      [...JSON.parse(forward).map((r: { id: string }) => r.id)].sort(),
    );
  });
});


// Each declaration carries its authored name; internal handles remain opaque.
import { buildRelations } from './index.js';

describe('feature membership in assembled relations', () => {
  it('emits a stated edge using the exact scoped UserStory declaration', () => {
    const feature = makeEntity({
      id: 'feature-handle',
      displayId: 'shop.CAP101',
      type: ENTITY_TYPE.Capability,
      data: { id: 'shop.CAP101', name: 'Order capture', kind: 'feature', user_stories: ['shop.US101'] },
    });
    const story = makeEntity({
      id: 'story-handle',
      displayId: 'shop.US101',
      type: ENTITY_TYPE.UserStory,
      data: { id: 'shop.US101', name: 'Capture an order' },
    });
    const result = buildRelations([feature, story], {});
    expect(result.relations.filter(relation => relation.type === 'feature_user_story')).toEqual([{
      id: 'feature-handle--feature_user_story--story-handle',
      source_entity_id: feature.id,
      target_entity_id: story.id,
      type: 'feature_user_story',
      data: { origin: 'stated' },
    }]);
  });
});
