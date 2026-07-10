import { describe, it, expect } from 'vitest';
import { extractMembershipRelations, findMembershipGaps } from './membership.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

// ── fixture builders ──────────────────────────────────────────────────────
function ctx(id: string, name: string, party: string, typedId: string, scope?: string): Entity {
  return {
    id, displayId: name, term: name, type: ENTITY_TYPE.Context, layer: 'arch',
    data: { _party: party, id: typedId, ...(scope ? { _scope: scope } : {}) },
  };
}
function op(id: string, displayId: string, name: string, contextName: string, kind: string): Entity {
  return {
    id, displayId, term: name, type: ENTITY_TYPE.Operation, layer: 'domain',
    data: { _context_name: contextName, kind },
  };
}
function contract(id: string, ownerContext: string, party: string, refs: Record<string, string[]>): Entity {
  return { id, displayId: id, type: ENTITY_TYPE.Contract, layer: 'arch', data: { _context: ownerContext, _party: party, ...refs } };
}
function question(id: string, displayId: string, data: Record<string, unknown>): Entity {
  return { id, displayId, type: ENTITY_TYPE.Question, layer: 'domain', data };
}

const edgesOf = (rels: ReturnType<typeof extractMembershipRelations>, type: string) =>
  rels.filter((r) => r.type === type);
const targetsFrom = (rels: ReturnType<typeof extractMembershipRelations>, type: string, source: string) =>
  edgesOf(rels, type).filter((r) => r.source_entity_id === source).map((r) => r.target_entity_id);

describe('extractMembershipRelations — handled_by (op→BC, D15)', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const shipping = ctx('ctx-shipping', 'Shipping', 'Shop', 'shop.BC002');
  // op1 domain name matches NO context name/scope → only a contract can bind it.
  const op1 = op('op-1', 'CMD001', 'PlaceOrder', 'orders-domain', 'command');
  // op2 binds only by the legacy name/scope fallback.
  const op2 = op('op-2', 'CMD002', 'ShipOrder', 'Shipping', 'command');
  const c1 = contract('ctr-1', 'Orders', 'Shop', { expose: ['orders-domain:PlaceOrder'] });
  const c2 = contract('ctr-2', 'Shipping', 'Shop', { receive: ['orders-domain:PlaceOrder'] });
  const rels = extractMembershipRelations([orders, shipping, op1, op2, c1, c2]);

  it('binds an op to a context via contract expose (no name/scope match), tagged contract', () => {
    const targets = targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-1');
    expect(targets).toEqual(['ctx-orders']);
    const edge = edgesOf(rels, RELATION_TYPE.HandledBy).find((r) => r.source_entity_id === 'op-1');
    expect((edge!.data as { resolution: string }).resolution).toBe('contract');
  });

  it('does NOT bind a merely-received op to the consumer (producer-only, m:n)', () => {
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-1')).not.toContain('ctx-shipping');
  });

  it('binds an un-contracted op via the deprecated name/scope fallback, tagged legacy', () => {
    const targets = targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-2');
    expect(targets).toEqual(['ctx-shipping']);
    const edge = edgesOf(rels, RELATION_TYPE.HandledBy).find((r) => r.source_entity_id === 'op-2');
    expect((edge!.data as { resolution: string }).resolution).toBe('legacy');
  });
});

describe('extractMembershipRelations — scoped_to (question→BC, D17)', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const shipping = ctx('ctx-shipping', 'Shipping', 'Shop', 'shop.BC002');

  it('binds a question by explicit prefixed BC### ref (single-valued, tagged ref)', () => {
    const q = question('q-1', 'QN001', { bounded_context_ref: 'shop.BC001' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    const targets = targetsFrom(rels, RELATION_TYPE.ScopedTo, 'q-1');
    expect(targets).toEqual(['ctx-orders']);
    expect((edgesOf(rels, RELATION_TYPE.ScopedTo)[0]!.data as { resolution: string }).resolution).toBe('ref');
  });

  it('accepts the legacy kebab-context-name form (D7 shim)', () => {
    const q = question('q-2', 'QN002', { bounded_context_ref: 'shipping' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    expect(targetsFrom(rels, RELATION_TYPE.ScopedTo, 'q-2')).toEqual(['ctx-shipping']);
  });

  it('falls back to name/scope when no explicit ref, tagged legacy', () => {
    const q = question('q-3', 'QN003', { _context_name: 'Orders' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    const targets = targetsFrom(rels, RELATION_TYPE.ScopedTo, 'q-3');
    expect(targets).toEqual(['ctx-orders']);
    expect((edgesOf(rels, RELATION_TYPE.ScopedTo)[0]!.data as { resolution: string }).resolution).toBe('legacy');
  });

  it('emits NO edge when the explicit ref points at an unknown BC### (unbound/dangling)', () => {
    const q = question('q-4', 'QN004', { bounded_context_ref: 'shop.BC999' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    expect(edgesOf(rels, RELATION_TYPE.ScopedTo)).toHaveLength(0);
  });
});

describe('extractMembershipRelations — exclusions & inertness', () => {
  it('does NOT emit a membership edge for Concepts (D17 — genuinely m:n, excluded)', () => {
    const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
    const concept: Entity = {
      id: 'cn-1', displayId: 'CN001', term: 'Order', type: ENTITY_TYPE.Concept, layer: 'domain',
      data: { _context_name: 'Orders' },
    };
    const rels = extractMembershipRelations([orders, concept]);
    expect(rels).toHaveLength(0);
  });

  it('emits nothing when there are no contexts (concept/rule-only fixtures stay at 0)', () => {
    const op1 = op('op-1', 'CMD001', 'PlaceOrder', 'orders-domain', 'command');
    expect(extractMembershipRelations([op1])).toHaveLength(0);
  });
});

describe('findMembershipGaps — resolvability (D5/D15/D17)', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const shipping = ctx('ctx-shipping', 'Shipping', 'Shop', 'shop.BC002');
  const gaps = (es: Entity[]) => findMembershipGaps(es, extractMembershipRelations(es));

  it('flags an unbound operation (no contract, no name/scope match)', () => {
    const orphan = op('op-x', 'CMD099', 'Orphan', 'nowhere-domain', 'command');
    const found = gaps([orders, shipping, orphan]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ entityId: 'op-x', entityType: 'Operation', reason: 'unbound' });
  });

  it('does NOT flag a bound operation (name/scope match)', () => {
    const bound = op('op-2', 'CMD002', 'ShipOrder', 'Shipping', 'command');
    expect(gaps([orders, shipping, bound])).toHaveLength(0);
  });

  it('flags an unbound question (no ref, no name/scope) as unbound', () => {
    const found = gaps([orders, shipping, question('q-x', 'QN099', {})]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ entityType: 'Question', reason: 'unbound' });
  });

  it('flags a question whose ref points at an unknown BC### as dangling', () => {
    const found = gaps([orders, shipping, question('q-d', 'QN100', { bounded_context_ref: 'shop.BC999' })]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ reason: 'dangling', ref: 'shop.BC999' });
  });

  it('does NOT flag a bound question (explicit ref resolves)', () => {
    expect(gaps([orders, shipping, question('q-b', 'QN101', { bounded_context_ref: 'shop.BC001' })])).toHaveLength(0);
  });

  it('returns [] when the model declares no bounded contexts (no arch layer yet)', () => {
    const lonelyOp = op('op-1', 'CMD001', 'PlaceOrder', 'orders-domain', 'command');
    expect(gaps([lonelyOp])).toHaveLength(0);
  });
});

describe('extractMembershipRelations — match provenance + loose-bind advisory (Decyzja 1 A)', () => {
  const catalog = ctx('ctx-cat', 'Catalog', 'Shop', 'shop.BC010');
  const mkop = (id: string, disp: string, name: string): Entity => ({
    id, displayId: disp, term: name, type: ENTITY_TYPE.Operation, layer: 'domain',
    data: { _context_name: 'Category', _scope: 'catalog', kind: 'command' },
  });
  const exactOp = mkop('op-e', 'catalog.CMD001', 'AddProduct'); // exact domainName:opName ref
  const looseOp = mkop('op-l', 'catalog.CMD002', 'UpdateProduct'); // scope-qualified + camelCase ref
  const c = contract('ctr-cat', 'Catalog', 'Shop', {
    expose: ['Category:AddProduct', 'catalog:updateProduct'],
  });
  const es = [catalog, exactOp, looseOp, c];
  const rels = extractMembershipRelations(es);
  const handledEdge = (src: string) =>
    rels.find((r) => r.type === RELATION_TYPE.HandledBy && r.source_entity_id === src);

  it('tags an exact domainName:opName bind as match=exact', () => {
    expect((handledEdge('op-e')!.data as { match: string }).match).toBe('exact');
  });

  it('tags a scope-qualified + case-folded bind as match=loose', () => {
    expect((handledEdge('op-l')!.data as { match: string }).match).toBe('loose');
  });

  it('findMembershipGaps reports the loose-only bind as loose-bind, not the exact one', () => {
    const byId = new Map(findMembershipGaps(es, rels).map((g) => [g.entityId, g.reason]));
    expect(byId.get('op-l')).toBe('loose-bind');
    expect(byId.has('op-e')).toBe(false);
  });
});
