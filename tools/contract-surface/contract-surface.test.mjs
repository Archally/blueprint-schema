// Contract-surface semantics, pinned against a fixture that exercises every join.
// Run with: node --test tools/contract-surface/contract-surface.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  buildContractSurface,
  deriveServiceEdges,
  deriveSurfaceGaps,
  aggregateEdges,
  normaliseService,
  PROTOCOL_LABEL,
  PROTOCOL_ORDER,
} from './contract-surface.mjs';

// ── Fixture, in the GENERATOR's object shape ────────────────────────────────────────────────────
// Orders exposes two HTTP ops and sends one event; Checkout calls one of them and receives the
// event; Billing calls an op nobody exposes; Reporting exposes an op nobody calls; Search does RPC.
const GENERATOR_SHAPE = [
  { name: 'OrderService', contracts: {
    openapi: { expose: ['orders.CMD001', 'orders.CMD002'] },
    asyncapi: { send: ['orders.EVT001'], brokerId: 'IR900' } } },
  { name: 'CheckoutService', contracts: {
    httpClient: { call: ['orders.CMD001'] },
    asyncapi: { receive: ['orders.EVT001'] } } },
  { name: 'BillingService', contracts: { httpClient: { call: ['ledger.CMD009'] } } },
  { name: 'ReportingService', contracts: { openapi: { expose: ['reports.QRY001'] } } },
  { name: 'SearchService', contracts: { openrpc: { expose: ['search.QRY100'] } } },
  { name: 'CatalogService', contracts: { openrpc: { call: ['search.QRY100'] } } },
];

/** The same model in the ARCH PROJECTION's array shape, plus stable keys. */
const PROJECTION_SHAPE = [
  { key: 'SVC001', name: 'OrderService', contracts: [
    { kind: 'openapi', expose: ['orders.CMD001', 'orders.CMD002'], call: [], send: [], receive: [], brokerId: null },
    { kind: 'asyncapi', expose: [], call: [], send: ['orders.EVT001'], receive: [], brokerId: 'IR900' } ] },
  { key: 'SVC002', name: 'CheckoutService', contracts: [
    { kind: 'httpClient', expose: [], call: ['orders.CMD001'], send: [], receive: [], brokerId: null },
    { kind: 'asyncapi', expose: [], call: [], send: [], receive: ['orders.EVT001'], brokerId: null } ] },
];

const surface = buildContractSurface(GENERATOR_SHAPE);

test('both input shapes normalise to the same surface', () => {
  const fromObject = normaliseService(GENERATOR_SHAPE[0]);
  const fromArray = normaliseService(PROJECTION_SHAPE[0]);
  assert.deepEqual(fromObject.expose, fromArray.expose);
  assert.deepEqual(fromObject.send, fromArray.send);
  assert.equal(fromObject.brokerId, fromArray.brokerId);
  // Identity differs BY DESIGN: the generator has only a name, the projection has a stable key.
  assert.equal(fromObject.id, 'OrderService');
  assert.equal(fromArray.id, 'SVC001');
});

test('two contracts of the same kind concatenate rather than overwrite', () => {
  const merged = normaliseService({ name: 'Multi', contracts: [
    { kind: 'asyncapi', send: ['a'], receive: [], expose: [], call: [], brokerId: null },
    { kind: 'asyncapi', send: ['b'], receive: ['c'], expose: [], call: [], brokerId: 'IR1' },
  ] });
  assert.deepEqual(merged.send, ['a', 'b']);
  assert.deepEqual(merged.receive, ['c']);
  assert.equal(merged.brokerId, 'IR1');
});

test('the three joins each produce an edge with the right protocol', () => {
  const { edges } = deriveServiceEdges(surface);
  const find = (/** @type {string} */ consumer, /** @type {string} */ provider) =>
    edges.find((e) => e.consumer === consumer && e.provider === provider);
  console.log(`      ${edges.length} edges: ${edges.map((e) => `${e.consumer}-${e.protocol}->${e.provider}`).join(', ')}`);
  assert.equal(find('CheckoutService', 'OrderService')?.protocol, 'http');
  assert.equal(edges.find((e) => e.protocol === 'message')?.consumer, 'CheckoutService');
  assert.equal(find('CatalogService', 'SearchService')?.protocol, 'rpc');
  assert.equal(edges.length, 3);
});

test('brokerId comes from the PRODUCER and only onto message edges', () => {
  const { edges } = deriveServiceEdges(surface);
  const message = edges.find((e) => e.protocol === 'message');
  assert.equal(message?.brokerId, 'IR900', 'the producer declared it; nothing else may invent one');
  assert.equal(edges.find((e) => e.protocol === 'http')?.brokerId, null);
});

test('a typed broker_ref is the broker, in both input shapes', () => {
  const fromObject = normaliseService({ name: 'OrderService', contracts: {
    asyncapi: { send: ['orders.EVT001'], broker_ref: 'IR006' } } });
  const fromArray = normaliseService({ key: 'SVC001', name: 'OrderService', contracts: [
    { kind: 'asyncapi', send: ['orders.EVT001'], broker_ref: 'IR006' }] });
  assert.equal(fromObject.brokerId, 'IR006');
  assert.equal(fromArray.brokerId, 'IR006');
  // The superseded free string still names the broker where nothing else does.
  const legacy = normaliseService({ name: 'OrderService', contracts: { asyncapi: { brokerId: 'shop-bus' } } });
  assert.equal(legacy.brokerId, 'shop-bus');
});

test('matching is EXACT - a same-bare-id ref in another scope is not a match', () => {
  const scoped = buildContractSurface([
    { name: 'A', contracts: { openapi: { expose: ['contracts.DOC001'] } } },
    { name: 'B', contracts: { httpClient: { call: ['customers.DOC001'] } } },
  ]);
  const { edges, warnings } = deriveServiceEdges(scoped);
  console.log(`      scoped refs → ${edges.length} edge(s), ${warnings.length} warning(s)`);
  assert.equal(edges.length, 0, 'loosening this would invent edges between unrelated contexts');
  assert.equal(warnings.length, 1);
});

test('a service calling its own exposed operation is not an edge', () => {
  const selfish = buildContractSurface([
    { name: 'Solo', contracts: { openapi: { expose: ['x.CMD1'] }, httpClient: { call: ['x.CMD1'] } } },
  ]);
  assert.deepEqual(deriveServiceEdges(selfish).edges, []);
});

test('Pact placeholder endpoints never reach an architecture edge', () => {
  const withPlaceholder = buildContractSurface([
    { name: 'Real', contracts: { openapi: { expose: ['x.CMD1'] } } },
    { name: 'UnknownConsumer', contracts: { httpClient: { call: ['x.CMD1'] } } },
  ]);
  assert.deepEqual(deriveServiceEdges(withPlaceholder).edges, []);
});

test('operations accumulate on one edge instead of producing duplicates', () => {
  const many = buildContractSurface([
    { name: 'P', contracts: { openapi: { expose: ['a', 'b', 'c'] } } },
    { name: 'C', contracts: { httpClient: { call: ['a', 'b', 'c'] } } },
  ]);
  const { edges } = deriveServiceEdges(many);
  assert.equal(edges.length, 1, 'one pair, one protocol, one edge');
  assert.deepEqual(edges[0].operations, ['a', 'b', 'c'], 'sorted, so the count is stable');
});

test('the three gap classes are separated, and an unconsumed expose is not called a defect', () => {
  const gaps = deriveSurfaceGaps(surface);
  console.log(`      exposedUnconsumed ${gaps.exposedUnconsumed.length} · calledUnprovided ` +
    `${gaps.calledUnprovided.length} · sentUnreceived ${gaps.sentUnreceived.length}`);
  // orders.CMD002 and reports.QRY001 are exposed with no modelled consumer - externally-facing
  // surface until the model says otherwise, which is the caller's call, not this module's.
  assert.deepEqual(gaps.exposedUnconsumed.map((g) => g.ref).sort(), ['orders.CMD002', 'reports.QRY001']);
  assert.equal(gaps.exposedUnconsumed.every((g) => g.externalDeclared === false), true);
  assert.deepEqual(gaps.calledUnprovided.map((g) => g.ref), ['ledger.CMD009']);
  assert.deepEqual(gaps.sentUnreceived, [], 'orders.EVT001 has a receiver');
  assert.ok(gaps.exposedUnconsumed.every((g) => g.kind), 'the contract kind is part of the finding');
});

test('a declared external consumer flips exposedUnconsumed from gap to fact', () => {
  const gaps = deriveSurfaceGaps(surface, { externalConsumers: new Set(['reports.QRY001']) });
  const reports = gaps.exposedUnconsumed.find((g) => g.ref === 'reports.QRY001');
  assert.equal(reports?.externalDeclared, true);
});

test('aggregateEdges rolls up to a grouping and drops self-pairs', () => {
  const { edges } = deriveServiceEdges(surface);
  /** @type {Map<string, string>} */
  const group = new Map([
    ['OrderService', 'BC-Orders'], ['CheckoutService', 'BC-Checkout'],
    ['SearchService', 'BC-Orders'], ['CatalogService', 'BC-Orders'],
  ]);
  const rolled = aggregateEdges(edges, (id) => group.get(id) ?? null);
  console.log(`      ${edges.length} service edges → ${rolled.size} context pair(s)`);
  // Checkout→Orders is both HTTP and message: ONE pair carrying two protocols, not two pairs.
  const pair = rolled.get('BC-Checkout->BC-Orders');
  assert.deepEqual(pair?.protocols, ['http', 'message']);
  assert.equal(pair?.operations.length, 2);
  assert.deepEqual(pair?.brokerIds, ['IR900']);
  // Catalog→Search is inside BC-Orders and must not become an edge.
  assert.equal(rolled.size, 1);
});

test('the surface is deterministic and independent of service order', () => {
  const forward = deriveServiceEdges(buildContractSurface(GENERATOR_SHAPE)).edges;
  const reversed = deriveServiceEdges(buildContractSurface(GENERATOR_SHAPE.slice().reverse())).edges;
  assert.deepEqual(forward, reversed);
});

test('empty and malformed input degrade instead of throwing', () => {
  // The casts are the point of the test, not a workaround for it: `SurfaceInput` forbids `null`,
  // and plenty of callers are plain JS that will hand one over anyway. This asserts the runtime
  // holds when the type does not.
  assert.deepEqual(deriveServiceEdges(buildContractSurface([])).edges, []);
  assert.deepEqual(
    deriveServiceEdges(buildContractSurface(/** @type {any[]} */ ([{}, { name: 'x' }, null]))).edges,
    [],
  );
  assert.equal(normaliseService({ name: 'n', contracts: 'nonsense' }).expose.length, 0);
  assert.equal(PROTOCOL_LABEL.http, 'HTTP');
});

// ── The three pairings that cross no wire ───────────────────────────────────────────────────────
// They join on the same terms as the three above - a provider verb and a consumer verb naming one
// operation ref - so what these tests guard is that the new verbs are READ, not that the join
// works. A pairing whose verbs are never picked yields an empty index, and an empty index is
// indistinguishable from a model that declares nothing.

test('the three transport-free pairings each produce an edge with their own protocol', () => {
  const wireless = buildContractSurface([
    { name: 'OrderModule', contracts: {
      inprocess: { provide: ['orders:placeOrder'] },
      shareddata: { contract_name: 'customer-record', write: ['orders:customerExport'] },
      scheduledtransfer: { contract_name: 'nightly-ledger', write: ['orders:ledgerExtract'] },
    } },
    { name: 'BillingModule', contracts: {
      inprocess: { consume: ['orders:placeOrder'] },
      shareddata: { contract_name: 'customer-record', read: ['orders:customerExport'] },
      scheduledtransfer: { contract_name: 'nightly-ledger', read: ['orders:ledgerExtract'] },
    } },
  ]);
  const { edges, warnings } = deriveServiceEdges(wireless);
  console.log(`      ${edges.length} edges: ${edges.map((e) => `${e.consumer}-${e.protocol}->${e.provider}`).join(', ')}`);
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
  assert.equal(edges.length, 3);
  for (const protocol of ['inprocess', 'shareddata', 'scheduledtransfer']) {
    const edge = edges.find((e) => e.protocol === protocol);
    assert.ok(edge, `no ${protocol} edge`);
    assert.equal(edge.consumer, 'BillingModule');
    assert.equal(edge.provider, 'OrderModule');
    assert.equal(edge.brokerId, null, 'none of the three has a broker');
  }
});

test('the writer is the provider on both data pairings, so the edge points reader to writer', () => {
  // The asymmetry is the point: the writer owns the schema and the reader is bound to it, which is
  // the same direction a caller-to-callee edge runs even though nobody calls anybody here.
  const store = buildContractSurface([
    { name: 'Writer', contracts: { shareddata: { contract_name: 'ledger', write: ['fin:ledgerRow'] } } },
    { name: 'Reader', contracts: { shareddata: { contract_name: 'ledger', read: ['fin:ledgerRow'] } } },
  ]);
  const { edges } = deriveServiceEdges(store);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].consumer, 'Reader');
  assert.equal(edges[0].provider, 'Writer');
});

test('a consumer verb with no matching provider warns, and names the verb', () => {
  const halfPair = buildContractSurface([
    { name: 'BillingModule', contracts: { inprocess: { consume: ['orders:placeOrder'] } } },
  ]);
  const { edges, warnings } = deriveServiceEdges(halfPair);
  assert.equal(edges.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /In-process call "orders:placeOrder"/);
});

test('the array input shape carries the new verbs too', () => {
  // The arch projection hands contracts as an array of `{ kind, ... }`. A verb picked from the
  // object shape and dropped from the array shape would work in tests and fail on a real model.
  const viaArray = buildContractSurface([
    { name: 'OrderModule', contracts: [{ kind: 'inprocess', provide: ['orders:placeOrder'] }] },
    { name: 'BillingModule', contracts: [{ kind: 'inprocess', consume: ['orders:placeOrder'] }] },
  ]);
  const { edges } = deriveServiceEdges(viaArray);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].protocol, 'inprocess');
  assert.deepEqual(edges[0].operations, ['orders:placeOrder']);
});

test('every protocol the join can emit has a display order and a label', () => {
  // Every derived protocol has an order and label so renderers can display its edges and legend.
  const everyPairing = buildContractSurface([
    { name: 'Provider', contracts: {
      openapi: { expose: ['a:one'] },
      asyncapi: { send: ['a:two'], brokerId: 'IR900' },
      openrpc: { expose: ['a:three'] },
      mcp: { contract_name: 'tools', expose: ['a:seven'] },
      cli: { contract_name: 'tool', expose: ['a:eight'] },
      inprocess: { provide: ['a:four'] },
      shareddata: { contract_name: 'store', write: ['a:five'] },
      scheduledtransfer: { contract_name: 'nightly', write: ['a:six'] },
    } },
    { name: 'Consumer', contracts: {
      httpClient: { call: ['a:one'] },
      asyncapi: { receive: ['a:two'] },
      openrpc: { call: ['a:three'] },
      mcp: { contract_name: 'agent', call: ['a:seven'] },
      cli: { contract_name: 'scripts', call: ['a:eight'] },
      inprocess: { consume: ['a:four'] },
      shareddata: { contract_name: 'store', read: ['a:five'] },
      scheduledtransfer: { contract_name: 'nightly', read: ['a:six'] },
    } },
  ]);
  const { edges } = deriveServiceEdges(everyPairing);
  const emitted = [...new Set(edges.map((edge) => edge.protocol))].sort();
  console.log(`      ${emitted.length} protocols emitted: ${emitted.join(', ')}`);
  assert.equal(emitted.length, 8, 'eight pairings, eight protocols');
  for (const protocol of emitted) {
    assert.ok(PROTOCOL_ORDER.includes(protocol), `${protocol} has no display order`);
    assert.ok(PROTOCOL_LABEL[protocol], `${protocol} has no display label`);
  }
});

test('an mcp pair and a cli pair each produce one edge carrying their own protocol', () => {
  const tools = buildContractSurface([
    { name: 'ModelServer', contracts: { mcp: { contract_name: 'model-tools', expose: ['tools.QRY001'] } } },
    { name: 'ToolCommand', contracts: { cli: { contract_name: 'tool', expose: ['tools.CMD001'] } } },
    { name: 'Assistant', contracts: {
      mcp: { contract_name: 'assistant-tools', call: ['tools.QRY001'] },
      cli: { contract_name: 'assistant-scripts', call: ['tools.CMD001'] },
    } },
  ]);
  const { edges, warnings } = deriveServiceEdges(tools);
  console.log(`      ${edges.length} edges: ${edges.map((e) => `${e.consumer}-${e.protocol}->${e.provider}`).join(', ')}`);
  assert.deepEqual(warnings, []);
  assert.deepEqual(edges.map((e) => [e.consumer, e.protocol, e.provider, e.operations, e.brokerId]), [
    ['Assistant', 'mcp', 'ModelServer', ['tools.QRY001'], null],
    ['Assistant', 'cli', 'ToolCommand', ['tools.CMD001'], null],
  ]);
});

test('a protobuf pair is one rpc edge, and its unanswered halves are gaps of kind protobuf', () => {
  const grpc = buildContractSurface([
    { name: 'BasketApi', contracts: { protobuf: {
      contract_name: 'basket', file: 'src/Basket.API/Proto/basket.proto',
      expose: ['basket.QRY001', 'basket.CMD002'] } } },
    { name: 'WebApp', contracts: { protobuf: {
      contract_name: 'basket-client', file: 'src/Basket.API/Proto/basket.proto',
      call: ['basket.QRY001', 'basket.CMD009'] } } },
  ]);
  const { edges } = deriveServiceEdges(grpc);
  assert.deepEqual(edges.map((e) => [e.consumer, e.protocol, e.provider, e.operations, e.brokerId]), [
    ['WebApp', 'rpc', 'BasketApi', ['basket.QRY001'], null],
  ]);
  const gaps = deriveSurfaceGaps(grpc);
  assert.deepEqual(gaps.exposedUnconsumed.map((g) => [g.ref, g.kind, g.services]), [
    ['basket.CMD002', 'protobuf', ['BasketApi']],
  ]);
  assert.deepEqual(gaps.calledUnprovided.map((g) => [g.ref, g.kind, g.services]), [
    ['basket.CMD009', 'protobuf', ['WebApp']],
  ]);
});

test('mcp, cli, openrpc and protobuf join only within their own kind', () => {
  // Every caller names an operation another kind exposes. A join on the operation alone would draw
  // twelve edges; the model states none of them. openrpc and protobuf share the rpc protocol, so
  // only the kind keeps a gRPC client from pairing with a JSON-RPC server.
  const kinds = ['openrpc', 'protobuf', 'mcp', 'cli'];
  for (const callerKind of kinds) {
    for (const providerKind of kinds) {
      if (callerKind === providerKind) continue;
      const crossed = buildContractSurface([
        { name: 'Provider', contracts: { [providerKind]: { contract_name: 'p', expose: ['x:op'] } } },
        { name: 'Caller', contracts: { [callerKind]: { contract_name: 'c', call: ['x:op'] } } },
      ]);
      const { edges, warnings } = deriveServiceEdges(crossed);
      assert.deepEqual(edges, [], `${callerKind}.call joined ${providerKind}.expose`);
      assert.equal(warnings.length, 1, `${callerKind}.call with no ${callerKind} provider warns`);
    }
  }
});

test('an mcp or cli exposure nobody calls is outward surface, and a call nobody answers is a gap', () => {
  const half = buildContractSurface([
    { name: 'ModelServer', contracts: { mcp: { contract_name: 'model-tools', expose: ['tools.QRY001'] } } },
    { name: 'ToolCommand', contracts: { cli: { contract_name: 'tool', expose: ['tools.CMD001'] } } },
    { name: 'Assistant', contracts: { cli: { contract_name: 'scripts', call: ['tools.CMD009'] } } },
  ]);
  const gaps = deriveSurfaceGaps(half);
  assert.deepEqual(gaps.exposedUnconsumed.map((g) => [g.ref, g.kind, g.services]), [
    ['tools.QRY001', 'mcp', ['ModelServer']],
    ['tools.CMD001', 'cli', ['ToolCommand']],
  ]);
  assert.deepEqual(gaps.calledUnprovided.map((g) => [g.ref, g.kind, g.services]), [
    ['tools.CMD009', 'cli', ['Assistant']],
  ]);
});

test('the array input shape carries mcp and cli too', () => {
  const viaArray = buildContractSurface([
    { name: 'ModelServer', contracts: [{ kind: 'mcp', expose: ['tools.QRY001'] }] },
    { name: 'Assistant', contracts: [{ kind: 'mcp', call: ['tools.QRY001'] }] },
  ]);
  const { edges } = deriveServiceEdges(viaArray);
  assert.deepEqual(edges.map((e) => [e.consumer, e.protocol, e.provider]), [['Assistant', 'mcp', 'ModelServer']]);
});
