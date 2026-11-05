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
/** An in-process provider is an extracted Contract entity carrying `provide`.
* A service's nested `contracts:` block is lifted into Contract entities before binding.
*/
function inProcessProvider(id: string, ownerContext: string, party: string, provide: string[]): Entity {
  return contract(id, ownerContext, party, { provide });
}
function question(id: string, displayId: string, data: Record<string, unknown>): Entity {
  return { id, displayId, type: ENTITY_TYPE.Question, layer: 'domain', data };
}

const edgesOf = (rels: ReturnType<typeof extractMembershipRelations>, type: string) =>
  rels.filter((r) => r.type === type);
const targetsFrom = (rels: ReturnType<typeof extractMembershipRelations>, type: string, source: string) =>
  edgesOf(rels, type).filter((r) => r.source_entity_id === source).map((r) => r.target_entity_id);

describe('extractMembershipRelations - handled_by (operation→bounded context)', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const shipping = ctx('ctx-shipping', 'Shipping', 'Shop', 'shop.BC002');
  // op1 domain name matches NO context name/scope → only a contract can bind it.
  const op1 = op('op-1', 'CMD001', 'PlaceOrder', 'orders-domain', 'command');
  // A matching file name does not bind op2 to a context.
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

  // A file name matching the Shipping context does not bind `op-2` without a declaration.
  it('does NOT bind an un-contracted op by its file name or scope', () => {
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-2')).toEqual([]);
  });

  it('does NOT bind an operation declared CMD777 by a scope-prefixed contract ref', () => {
    const beta = ctx('ctx-beta', 'Beta', 'Shop', 'shop.BC777', 'beta');
    const declaredOperation: Entity = {
      ...op('op-777', 'CMD777', 'DeclaredOperation', 'Other', 'command'),
      data: { _context_name: 'Other', _scope: 'beta', kind: 'command' },
    };
    const scopedRef = contract('ctr-beta', 'Beta', 'Shop', { expose: ['beta.CMD777'] });

    expect(extractMembershipRelations([beta, declaredOperation, scopedRef])
      .filter((relation) => relation.type === RELATION_TYPE.HandledBy && relation.source_entity_id === 'op-777'))
      .toEqual([]);
  });
});

describe('extractMembershipRelations - handled_by via `contracts.inprocess.provide` (no transport)', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const billing = ctx('ctx-billing', 'Billing', 'Shop', 'shop.BC003');
  // Binds by nothing else: its domain name matches no context name and no scope, and no protocol
  // contract names it. Without the in-process provider this operation is exactly the unbound case.
  const inProcess = op('op-3', 'CMD003', 'RecalculateTotals', 'pricing-domain', 'command');

  it('binds an operation a service provides in-process, with no protocol contract anywhere', () => {
    const rels = extractMembershipRelations([orders, inProcessProvider('ctr-1', 'Orders', 'Shop', ['pricing-domain:RecalculateTotals']), inProcess]);
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3')).toEqual(['ctx-orders']);
  });

  // An authored `provide:` binds with the same origin as an authored `expose:`.
  it('tags the edge `contract` - a declared bind, not the name/scope guess', () => {
    const rels = extractMembershipRelations([orders, inProcessProvider('ctr-1', 'Orders', 'Shop', ['pricing-domain:RecalculateTotals']), inProcess]);
    const edge = edgesOf(rels, RELATION_TYPE.HandledBy).find((r) => r.source_entity_id === 'op-3');
    expect((edge!.data as { resolution: string }).resolution).toBe('contract');
  });

  // The m:n case, and the reason this is a provider list rather than a single `owner:` field: a
  // domain operation genuinely provided in two bounded contexts must produce two edges, not a winner.
  it('produces one edge per context when two services in different contexts handle the same op', () => {
    const rels = extractMembershipRelations([
      orders,
      billing,
      inProcessProvider('ctr-1', 'Orders', 'Shop', ['pricing-domain:RecalculateTotals']),
      inProcessProvider('ctr-2', 'Billing', 'Shop', ['pricing-domain:RecalculateTotals']),
      inProcess,
    ]);
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3').sort()).toEqual(['ctx-billing', 'ctx-orders']);
  });

  // Provider references match operation names exactly; a case mismatch leaves `op-3` unbound.
  it('does not fold case - a camelCase ref against a PascalCase name binds nothing', () => {
    const rels = extractMembershipRelations([orders, inProcessProvider('ctr-1', 'Orders', 'Shop', ['pricing-domain:recalculateTotals']), inProcess]);
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3')).toEqual([]);
  });

  // Declared on the CONTRACT directly rather than through the service helper above, which is the
  // same key reached by the other shape an author may write.
  it('binds the same operation when the contract is its own entity', () => {
    const rels = extractMembershipRelations([
      orders,
      contract('ctr-1', 'Orders', 'Shop', { provide: ['pricing-domain:RecalculateTotals'] }),
      inProcess,
    ]);
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3')).toEqual(['ctx-orders']);
  });

  it('the writer of a shared or transferred document is its provider too', () => {
    // `write:` owns the schema of what it writes, so it binds the document the way `expose:` binds
    // an endpoint. `read:` is the consumer end and must not bind, which the next test holds.
    const rels = extractMembershipRelations([
      orders,
      contract('ctr-1', 'Orders', 'Shop', { write: ['pricing-domain:RecalculateTotals'] }),
      inProcess,
    ]);
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3')).toEqual(['ctx-orders']);
  });

  it('a contract that only CONSUMES or READS an operation does not bind it', () => {
    // Transport-free consumer verbs, like `call:`, do not declare ownership.
    for (const verb of ['consume', 'read']) {
      const rels = extractMembershipRelations([
        orders,
        contract('ctr-1', 'Orders', 'Shop', { [verb]: ['pricing-domain:RecalculateTotals'] }),
        inProcess,
      ]);
      expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3')).toEqual([]);
    }
  });

  // The negative control. Every assertion above would also pass if `handled_by` were produced for
  // any operation at all, so the same fixture minus the declaration must produce nothing.
  it('binds nothing when the service provides no operations', () => {
    const rels = extractMembershipRelations([orders, inProcessProvider('ctr-1', 'Orders', 'Shop', []), inProcess]);
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3')).toEqual([]);
  });

  // `call:` is the caller side and must never bind: recording the caller as the handler would give
  // an operation to whichever context depends on it.
  it('a service that only CALLS an operation does not handle it', () => {
    const caller = { id: 'svc-3', displayId: 'svc-3', type: ENTITY_TYPE.Service, layer: 'arch',
      data: { _context: 'Billing', _party: 'Shop', call: ['pricing-domain:RecalculateTotals'] } } as Entity;
    const rels = extractMembershipRelations([orders, billing, caller, inProcess]);
    expect(targetsFrom(rels, RELATION_TYPE.HandledBy, 'op-3')).toEqual([]);
  });
});

describe('extractMembershipRelations - scoped_to (question→bounded context)', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const shipping = ctx('ctx-shipping', 'Shipping', 'Shop', 'shop.BC002');

  it('binds a question by explicit prefixed BC### ref (single-valued, tagged ref)', () => {
    const q = question('q-1', 'QN001', { bounded_context_ref: 'shop.BC001' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    const targets = targetsFrom(rels, RELATION_TYPE.ScopedTo, 'q-1');
    expect(targets).toEqual(['ctx-orders']);
    expect((edgesOf(rels, RELATION_TYPE.ScopedTo)[0]!.data as { resolution: string }).resolution).toBe('ref');
  });

  // `bounded_context_ref` names a typed context id; a context name does not bind a question.
  it('rejects the kebab-context-name form, and the question is dangling rather than scoped', () => {
    const q = question('q-2', 'QN002', { bounded_context_ref: 'shipping' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    expect(targetsFrom(rels, RELATION_TYPE.ScopedTo, 'q-2')).toEqual([]);
    const byId = new Map(findMembershipGaps([orders, shipping, q], rels).map((g) => [g.entityId, g.reason]));
    expect(byId.get('q-2')).toBe('dangling');
  });

  // A question without `bounded_context_ref` is unbound even when its file name matches a context.
  it('emits NO edge when a question names no ref, whatever its file is called', () => {
    const q = question('q-3', 'QN003', { _context_name: 'Orders' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    expect(edgesOf(rels, RELATION_TYPE.ScopedTo)).toHaveLength(0);
  });

  it('emits NO edge when the explicit ref points at an unknown BC### (unbound/dangling)', () => {
    const q = question('q-4', 'QN004', { bounded_context_ref: 'shop.BC999' });
    const rels = extractMembershipRelations([orders, shipping, q]);
    expect(edgesOf(rels, RELATION_TYPE.ScopedTo)).toHaveLength(0);
  });
});

describe('extractMembershipRelations - exclusions & inertness', () => {
  it('does NOT emit a membership edge for Concepts (many-to-many, excluded)', () => {
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

describe('findMembershipGaps - resolvability', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const shipping = ctx('ctx-shipping', 'Shipping', 'Shop', 'shop.BC002');
  const gaps = (es: Entity[]) => findMembershipGaps(es, extractMembershipRelations(es));

  it('flags an unbound operation (no contract, no name/scope match)', () => {
    const orphan = op('op-x', 'CMD099', 'Orphan', 'nowhere-domain', 'command');
    const found = gaps([orders, shipping, orphan]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ entityId: 'op-x', entityType: 'Operation', reason: 'unbound' });
  });

  // An operation without a domain or provider declaration is reported as unbound.
  it('flags an operation whose only claim was a matching file name', () => {
    const bound = op('op-2', 'CMD002', 'ShipOrder', 'Shipping', 'command');
    const found = gaps([orders, shipping, bound]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ entityId: 'op-2', entityType: 'Operation', reason: 'unbound' });
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

describe('extractMembershipRelations - one ref form, and no second tier', () => {
  const catalog = ctx('ctx-cat', 'Catalog', 'Shop', 'shop.BC010');
  const mkop = (id: string, disp: string, name: string): Entity => ({
    id, displayId: disp, term: name, type: ENTITY_TYPE.Operation, layer: 'domain',
    data: { _context_name: 'Category', _scope: 'catalog', kind: 'command' },
  });
  const exactOp = mkop('op-e', 'catalog.CMD001', 'AddProduct'); // exact domainName:opName ref
  const looseOp = mkop('op-l', 'catalog.CMD002', 'UpdateProduct'); // A scope-qualified camelCase reference does not match the spaced operation name.
  const c = contract('ctr-cat', 'Catalog', 'Shop', {
    expose: ['Category:AddProduct', 'catalog:updateProduct'],
  });
  const es = [catalog, exactOp, looseOp, c];
  const rels = extractMembershipRelations(es);
  const handledEdge = (src: string) =>
    rels.find((r) => r.type === RELATION_TYPE.HandledBy && r.source_entity_id === src);

  it('binds an exact domainName:opName ref, and the edge records only its resolution', () => {
    const data = handledEdge('op-e')!.data as Record<string, unknown>;
    expect(data.resolution).toBe('contract');
    // Exact-case bindings carry no `match` classification.
    expect(data).not.toHaveProperty('match');
  });

  it('does not bind a scope-qualified, case-folded ref at all', () => {
    expect(handledEdge('op-l')).toBeUndefined();
  });

  it('findMembershipGaps reports the ref that no longer matches as unbound, not as an advisory', () => {
    const byId = new Map(findMembershipGaps(es, rels).map((g) => [g.entityId, g.reason]));
    expect(byId.get('op-l')).toBe('unbound');
    expect(byId.has('op-e')).toBe(false);
  });
});

describe('extractMembershipRelations - camelCase contract-ref convergence (v2.7.6 B)', () => {
  // The camelCase ref `catalog:getProduct` does not match the spaced operation name "Get Product".
  // The operation remains unbound.
  const catalog = ctx('ctx-cat', 'Catalog', 'Shop', 'shop.BC001');
  const spacedOp: Entity = {
    id: 'op-gp', displayId: 'catalog.QRY001', term: 'Get Product', type: ENTITY_TYPE.Operation, layer: 'domain',
    data: { _context_name: 'Catalog', _scope: 'catalog', kind: 'query' },
  };
  const c = contract('ctr-cat', 'Catalog', 'Shop', { expose: ['catalog:getProduct'] });
  const es = [catalog, spacedOp, c];
  const rels = extractMembershipRelations(es);
  const edge = rels.find((r) => r.type === RELATION_TYPE.HandledBy && r.source_entity_id === 'op-gp');

  it('does not bind the spaced-name op at all, because the ref matches nothing', () => {
    expect(edge).toBeUndefined();
  });

  it('reports the unmatched reference as unbound', () => {
    const byId = new Map(findMembershipGaps(es, rels).map((g) => [g.entityId, g.reason]));
    expect(byId.get('op-gp')).toBe('unbound');
  });
});

describe('findMembershipGaps - why an operation is unbound', () => {
  const orders = ctx('ctx-orders', 'Orders', 'Shop', 'shop.BC001');
  const shipping = ctx('ctx-shipping', 'Shipping', 'Shop', 'shop.BC002');
  const orphan = () => op('op-x', 'CMD099', 'Orphan', 'nowhere-domain', 'command');

  /** The two problem-space edges the reason reads, built by hand so the reason is tested alone. */
  const inDomain = (opId: string, domainId: string) => ({
    id: `${opId}--in--${domainId}`,
    source_entity_id: opId,
    target_entity_id: domainId,
    type: RELATION_TYPE.OperationInDomain,
  });
  const realizes = (contextId: string, domainId: string) => ({
    id: `${contextId}--realizes--${domainId}`,
    source_entity_id: contextId,
    target_entity_id: domainId,
    type: RELATION_TYPE.ContextRealizesDomain,
  });

  const reasonOf = (entities: Entity[], extra: ReturnType<typeof inDomain>[] = []) => {
    const found = findMembershipGaps(entities, [...extractMembershipRelations(entities), ...extra]);
    return found.find((gap) => gap.entityId === 'op-x')?.unboundReason;
  };

  it('reports no-domain-ref when the operation reaches no domain, which is every model today', () => {
    expect(reasonOf([orders, shipping, orphan()])).toBe('no-domain-ref');
  });

  it('reports no-context-for-domain when the two halves exist and do not meet', () => {
    expect(reasonOf([orders, shipping, orphan()], [inDomain('op-x', 'dom-1')])).toBe(
      'no-context-for-domain'
    );
  });

  it('reports single-context-domain when exactly one context realizes it - the derivable population', () => {
    expect(
      reasonOf([orders, shipping, orphan()], [inDomain('op-x', 'dom-1'), realizes('ctx-orders', 'dom-1')])
    ).toBe('single-context-domain');
  });

  it('reports multi-context-domain when two contexts realize it, so there is no single answer', () => {
    expect(
      reasonOf(
        [orders, shipping, orphan()],
        [
          inDomain('op-x', 'dom-1'),
          realizes('ctx-orders', 'dom-1'),
          realizes('ctx-shipping', 'dom-1'),
        ]
      )
    ).toBe('multi-context-domain');
  });

  it('leaves the reason null on a bound operation, because nothing needs explaining', () => {
    // A provider contract binds this operation without a domain declaration.
    const bound = op('op-2', 'CMD002', 'ShipOrder', 'Shipping', 'command');
    const provider = contract('ctr-ship', 'Shipping', 'Shop', { expose: ['CMD002'] });
    const es = [orders, shipping, bound, provider];
    expect(findMembershipGaps(es, extractMembershipRelations(es))).toHaveLength(0);
  });

  it('leaves the reason null on a question, which binds by a different mechanism entirely', () => {
    const unbound = question('q-1', 'QN001', {});
    const found = findMembershipGaps([orders, shipping, unbound], []);
    const gap = found.find((entry) => entry.entityId === 'q-1');
    expect(gap?.reason).toBe('unbound');
    expect(gap?.unboundReason).toBeNull();
  });
});
