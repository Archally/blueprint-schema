// @ts-check
// The CONTRACT SURFACE index: who exposes an operation, who calls it, who sends an event, who
// receives it — and therefore which services actually talk to each other, over what protocol, and
// how many operations flow between them.
//
// A dependency arrow that says only "A depends on B" answers almost nothing. The questions worth
// asking of an architecture are *how* (HTTP, message, RPC), *which way* (who calls whom), *how
// much* (how many operations), and *how tightly* (strength). Everything but the last is derivable
// from the authored contract refs, and this module is where that derivation lives — ONCE.
//
// ── Extraction, not reimplementation ────────────────────────────────────────────────────────────
// The semantics below are lifted from `viewer/generator/v2.6/src/generators/pact/discover-pairs.ts`
// and `mermaid/architecture/edges.ts`, which have shipped and are covered by 16 test cases:
//
//   · HTTP     `openapi.expose` (provider)  <-> `httpClient.call` (consumer)
//   · Message  `asyncapi.send` (producer)   <-> `asyncapi.receive` (consumer)
//   · RPC      `openrpc.expose`             <-> `openrpc.call`
//   · Matching is EXACT STRING EQUALITY on the ref. No scope stripping, no normalisation — a
//     `contracts.DOC001` is not a `customers.DOC001`, and loosening that would silently invent
//     edges between unrelated contexts.
//   · `brokerId` comes from the PROVIDER's asyncapi contract, never synthesised.
//   · Edges dedupe on `(consumer, provider, protocol)` with operations accumulated.
//
// Re-pointing the generator at this module is the remaining half of its own step; the semantics
// are pinned here first so the two cannot diverge while that is pending.
//
// ── Two input shapes, deliberately ──────────────────────────────────────────────────────────────
// The generator carries `contracts` as an OBJECT keyed by protocol; the arch projection normalises
// it to an ARRAY of `{ kind, expose, call, send, receive, brokerId }`. Both are accepted, because
// a shared index that only fits one caller is not shared. Nothing else about either shape is
// assumed — in particular this module never imports the generator's `ContractModel` type, which
// would drag its whole type surface into a portable kit.
//
// ── Identity is the caller's to choose ──────────────────────────────────────────────────────────
// The generator keys services by `name`. That is safe there and NOT safe generally: one real model
// declares a context called `Accounting` under three separate parties, and name-keyed services
// would fold distinct things into one. So identity is `service.key ?? service.name` — callers that
// carry a stable key get correct behaviour, and the generator's name-only services key exactly as
// they do today.

/**
 * @typedef {'http'|'message'|'rpc'} EdgeProtocol
 *
 * The accepted input. `contracts` is deliberately `unknown` rather than a union of the two shapes:
 * the generator's `ServiceContracts` is an INTERFACE, and TypeScript gives interfaces no implicit
 * index signature, so `Record<string, …>` would reject the very caller this module exists to serve.
 * The shape is discriminated at runtime in `normaliseService`, which handles either form and
 * ignores anything else — so a wrong shape yields an empty surface, never a crash.
 *
 * @typedef {Object} SurfaceInput
 * @property {string} [key]   stable identity, when the caller has one
 * @property {string} [name]  display name; the identity fallback
 * @property {unknown} [contracts] protocol-keyed object OR array of `{ kind, … }` entries
 *
 * @typedef {Object} SurfaceService
 * @property {string} id      the identity used for edge endpoints
 * @property {string} name    display name
 * @property {string[]} expose      openapi.expose
 * @property {string[]} call        httpClient.call
 * @property {string[]} send        asyncapi.send
 * @property {string[]} receive     asyncapi.receive
 * @property {string[]} rpcExpose   openrpc.expose
 * @property {string[]} rpcCall     openrpc.call
 * @property {string|null} brokerId asyncapi.brokerId
 * @property {SurfaceInput} source  the originating service, handed straight back to the caller
 *
 * @typedef {Object} ServiceEdge
 * @property {string} consumer
 * @property {string} provider
 * @property {EdgeProtocol} protocol
 * @property {string[]} operations
 * @property {string|null} brokerId
 */

/** Placeholder endpoints the Pact generator invents; they are not architecture. */
const PLACEHOLDER_NAMES = new Set(['UnknownConsumer', 'UnknownProducer']);

const asArray = (/** @type {any} */ value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

/**
 * Normalise one service from EITHER input shape.
 * @param {SurfaceInput} service
 * @returns {SurfaceService}
 */
export function normaliseService(service) {
  const contracts = service?.contracts;
  /** @type {Record<string, any>} */
  let byKind = {};
  if (Array.isArray(contracts)) {
    // arch projection: an array of per-protocol entries. Two entries of the same kind CONCATENATE
    // rather than overwrite — a service may legitimately declare more than one asyncapi contract.
    for (const entry of contracts) {
      const kind = entry?.kind;
      if (!kind) continue;
      const slot = byKind[kind] ?? (byKind[kind] = { expose: [], call: [], send: [], receive: [], brokerId: null });
      slot.expose.push(...asArray(entry.expose));
      slot.call.push(...asArray(entry.call));
      slot.send.push(...asArray(entry.send));
      slot.receive.push(...asArray(entry.receive));
      slot.brokerId = slot.brokerId ?? entry.brokerId ?? null;
    }
  } else if (contracts && typeof contracts === 'object') {
    byKind = contracts;
  }
  const pick = (/** @type {string} */ kind, /** @type {string} */ verb) => asArray(byKind[kind]?.[verb]);
  return {
    id: String(service?.key ?? service?.name ?? ''),
    name: String(service?.name ?? service?.key ?? ''),
    expose: pick('openapi', 'expose'),
    call: pick('httpClient', 'call'),
    send: pick('asyncapi', 'send'),
    receive: pick('asyncapi', 'receive'),
    rpcExpose: pick('openrpc', 'expose'),
    rpcCall: pick('openrpc', 'call'),
    brokerId: byKind.asyncapi?.brokerId ?? null,
    source: service,
  };
}

/**
 * Build the operation index.
 *
 * Every map is `operation ref -> SurfaceService[]`. A ref with more than one provider is kept as
 * such rather than resolved: two services exposing the same operation is a modelling question, and
 * silently picking one would answer it wrongly and invisibly.
 *
 * @param {SurfaceInput[]} services either shape; see the module header
 * @returns {{
 *   services: SurfaceService[],
 *   byId: Map<string, SurfaceService>,
 *   providersByOp: Map<string, SurfaceService[]>,
 *   consumersByOp: Map<string, SurfaceService[]>,
 *   producersByOp: Map<string, SurfaceService[]>,
 *   receiversByOp: Map<string, SurfaceService[]>,
 *   rpcProvidersByOp: Map<string, SurfaceService[]>,
 *   rpcConsumersByOp: Map<string, SurfaceService[]>,
 * }}
 */
export function buildContractSurface(services) {
  const normalised = (services ?? []).map(normaliseService).filter((service) => service.id);
  /** @type {Map<string, SurfaceService>} */
  const byId = new Map();
  for (const service of normalised) if (!byId.has(service.id)) byId.set(service.id, service);

  const index = () => /** @type {Map<string, SurfaceService[]>} */ (new Map());
  const providersByOp = index();
  const consumersByOp = index();
  const producersByOp = index();
  const receiversByOp = index();
  const rpcProvidersByOp = index();
  const rpcConsumersByOp = index();

  const add = (/** @type {Map<string, SurfaceService[]>} */ map, /** @type {string[]} */ refs, /** @type {SurfaceService} */ service) => {
    for (const ref of refs) {
      const list = map.get(ref) ?? [];
      if (!list.includes(service)) list.push(service);
      map.set(ref, list);
    }
  };

  for (const service of normalised) {
    add(providersByOp, service.expose, service);
    add(consumersByOp, service.call, service);
    add(producersByOp, service.send, service);
    add(receiversByOp, service.receive, service);
    add(rpcProvidersByOp, service.rpcExpose, service);
    add(rpcConsumersByOp, service.rpcCall, service);
  }

  return { services: normalised, byId, providersByOp, consumersByOp, producersByOp, receiversByOp, rpcProvidersByOp, rpcConsumersByOp };
}

/**
 * Derive service-to-service edges from the index.
 *
 * Deduped on `(consumer, provider, protocol)` with operations accumulated and sorted, so the
 * result is deterministic regardless of service order.
 *
 * @param {ReturnType<typeof buildContractSurface>} surface
 * @returns {{ edges: ServiceEdge[], warnings: string[] }}
 */
export function deriveServiceEdges(surface) {
  /** @type {Map<string, ServiceEdge>} */
  const accumulator = new Map();
  /** @type {string[]} */
  const warnings = [];

  const join = (
    /** @type {Map<string, SurfaceService[]>} */ consumerSide,
    /** @type {Map<string, SurfaceService[]>} */ providerSide,
    /** @type {EdgeProtocol} */ protocol,
    /** @type {string} */ verb,
  ) => {
    for (const [ref, consumers] of [...consumerSide.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const providers = providerSide.get(ref) ?? [];
      if (!providers.length) {
        warnings.push(`${verb} "${ref}" from ${consumers.map((s) => s.name).join(', ')} has no matching provider`);
        continue;
      }
      for (const consumer of consumers) {
        for (const provider of providers) {
          // A service calling its own exposed operation is an internal call, not an edge.
          if (consumer.id === provider.id) continue;
          if (PLACEHOLDER_NAMES.has(consumer.name) || PLACEHOLDER_NAMES.has(provider.name)) continue;
          const key = `${consumer.id}|${provider.id}|${protocol}`;
          const existing = accumulator.get(key);
          if (existing) {
            if (!existing.operations.includes(ref)) existing.operations.push(ref);
            if (!existing.brokerId && protocol === 'message') existing.brokerId = provider.brokerId;
            continue;
          }
          accumulator.set(key, {
            consumer: consumer.id,
            provider: provider.id,
            protocol,
            operations: [ref],
            brokerId: protocol === 'message' ? provider.brokerId : null,
          });
        }
      }
    }
  };

  join(surface.consumersByOp, surface.providersByOp, 'http', 'HTTP call');
  join(surface.receiversByOp, surface.producersByOp, 'message', 'Received event');
  join(surface.rpcConsumersByOp, surface.rpcProvidersByOp, 'rpc', 'OpenRPC call');

  const edges = [...accumulator.values()].map((edge) => ({ ...edge, operations: edge.operations.slice().sort() }));
  edges.sort((a, b) =>
    a.consumer < b.consumer ? -1 : a.consumer > b.consumer ? 1
      : a.provider < b.provider ? -1 : a.provider > b.provider ? 1
        : a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0);
  return { edges, warnings };
}

/**
 * The three surface gaps.
 *
 * `exposedUnconsumed` is the one that needs care: an operation with no MODELLED consumer is
 * usually externally-facing surface, not a defect — one real service exposes four operations and
 * exactly one is called internally. So each entry carries its contract kind and whether the model
 * declares an external consumer, and the CALLER decides what to call a gap. Reporting all three as
 * defects is how a complete model gets accused of being incomplete.
 *
 * @param {ReturnType<typeof buildContractSurface>} surface
 * @param {{ externalConsumers?: Set<string>, externalReceivers?: Set<string> }} [declared]
 */
export function deriveSurfaceGaps(surface, declared = {}) {
  const externalConsumers = declared.externalConsumers ?? new Set();
  const externalReceivers = declared.externalReceivers ?? new Set();
  const sortedEntries = (/** @type {Map<string, SurfaceService[]>} */ map) =>
    [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const exposedUnconsumed = [];
  for (const [ref, providers] of sortedEntries(surface.providersByOp)) {
    if ((surface.consumersByOp.get(ref) ?? []).length) continue;
    exposedUnconsumed.push({
      ref, kind: 'openapi', externalDeclared: externalConsumers.has(ref),
      services: providers.map((s) => s.name),
    });
  }
  for (const [ref, providers] of sortedEntries(surface.rpcProvidersByOp)) {
    if ((surface.rpcConsumersByOp.get(ref) ?? []).length) continue;
    exposedUnconsumed.push({
      ref, kind: 'openrpc', externalDeclared: externalConsumers.has(ref),
      services: providers.map((s) => s.name),
    });
  }

  const calledUnprovided = [];
  for (const [ref, consumers] of sortedEntries(surface.consumersByOp)) {
    if ((surface.providersByOp.get(ref) ?? []).length) continue;
    calledUnprovided.push({ ref, kind: 'httpClient', services: consumers.map((s) => s.name) });
  }
  for (const [ref, consumers] of sortedEntries(surface.rpcConsumersByOp)) {
    if ((surface.rpcProvidersByOp.get(ref) ?? []).length) continue;
    calledUnprovided.push({ ref, kind: 'openrpc', services: consumers.map((s) => s.name) });
  }

  const sentUnreceived = [];
  for (const [ref, producers] of sortedEntries(surface.producersByOp)) {
    if ((surface.receiversByOp.get(ref) ?? []).length) continue;
    sentUnreceived.push({
      ref, kind: 'asyncapi', externalDeclared: externalReceivers.has(ref),
      services: producers.map((s) => s.name),
    });
  }

  return { exposedUnconsumed, calledUnprovided, sentUnreceived };
}

/**
 * Roll service-level edges up to whatever grouping the caller cares about — bounded contexts for
 * the context map, parties for a system view. Self-pairs are dropped: a context talking to itself
 * is internal wiring, not a dependency.
 *
 * @param {ServiceEdge[]} edges
 * @param {(serviceId: string) => string|null} groupOf
 * @returns {Map<string, { from: string, to: string, protocols: EdgeProtocol[], operations: string[], brokerIds: string[] }>}
 */
export function aggregateEdges(edges, groupOf) {
  /** @type {Map<string, { from: string, to: string, protocols: EdgeProtocol[], operations: string[], brokerIds: string[] }>} */
  const grouped = new Map();
  for (const edge of edges) {
    const from = groupOf(edge.consumer);
    const to = groupOf(edge.provider);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    const entry = grouped.get(key) ?? { from, to, protocols: [], operations: [], brokerIds: [] };
    if (!entry.protocols.includes(edge.protocol)) entry.protocols.push(edge.protocol);
    for (const operation of edge.operations) if (!entry.operations.includes(operation)) entry.operations.push(operation);
    if (edge.brokerId && !entry.brokerIds.includes(edge.brokerId)) entry.brokerIds.push(edge.brokerId);
    grouped.set(key, entry);
  }
  for (const entry of grouped.values()) {
    entry.protocols.sort();
    entry.operations.sort();
    entry.brokerIds.sort();
  }
  return grouped;
}

/** Protocol order for display — HTTP first, then message, then RPC. Stable across renderers. */
export const PROTOCOL_ORDER = Object.freeze(['http', 'message', 'rpc']);

/** Short display glyph per protocol. Text, not colour — it has to survive a greyscale print. */
export const PROTOCOL_LABEL = Object.freeze({ http: 'HTTP', message: 'MSG', rpc: 'RPC' });
