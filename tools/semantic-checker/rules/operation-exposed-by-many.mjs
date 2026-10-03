/**
 * An operation three or more services provide.
 *
 * A service provides an operation when a contract it provides lists the operation under `expose`,
 * `send` or `provide`, whatever the contract's kind. The check counts DISTINCT services: one
 * service listing an operation under two contract kinds (an HTTP API and an MCP server, say)
 * counts once. Consumer-side verbs (`call`, `receive`, `consume`) never count, and neither does
 * `write`: a shared-store write is not an operation offered to others.
 *
 * INFO, not a defect: several services may expose one surface on purpose (a shared navigation
 * API every server of a family offers). The finding makes that shape visible on every model, so a
 * reader can confirm it or state the surface once where the model allows it.
 *
 * The module exports its definition as well as its check, so that a renderer drawing the same
 * shape reads the same threshold, verbs and grouping rather than restating them:
 *
 *   - `EXPOSED_BY_MANY_THRESHOLD`: how many distinct providers make an operation "exposed by many";
 *   - `PROVIDER_VERBS`: the contract verbs that count as providing;
 *   - `groupByProviders(pairs, minimum)`: the distinct providers of each operation, from plain
 *     (operation, service) pairs, so a caller that reads contract declarations rather than a
 *     built graph can use it.
 *
 * The check builds the grouping once per model and reads it per operation. The order of the
 * services in a message is their declared id in code-unit order, so the text does not depend on
 * the order the model's files were read in.
 */

/** How many distinct services must provide an operation before it is reported. */
export const EXPOSED_BY_MANY_THRESHOLD = 3;

/**
 * The contract verbs that make a service a provider of an operation.
 *
 * @type {readonly ['expose', 'send', 'provide']}
 */
export const PROVIDER_VERBS = Object.freeze(/** @type {const} */ (['expose', 'send', 'provide']));

/**
 * The distinct providers of each operation, for every operation with at least `minimum` of them.
 *
 * A pair names one operation and one service that provides it. A pair repeated (one service
 * listing the operation under two contract kinds) counts once. The result is sorted by operation,
 * and each operation's services are sorted, both in code-unit order, so it does not depend on the
 * order of the input.
 *
 * @param {Iterable<{ operation: string, service: string }>} pairs
 * @param {number} [minimum] the fewest distinct services an operation needs to be returned;
 *   defaults to `EXPOSED_BY_MANY_THRESHOLD`; pass 1 for every operation
 * @returns {Array<{ operation: string, services: string[] }>}
 */
export function groupByProviders(pairs, minimum = EXPOSED_BY_MANY_THRESHOLD) {
  /** @type {Map<string, Set<string>>} */
  const servicesByOperation = new Map();
  for (const { operation, service } of pairs) {
    const services = servicesByOperation.get(operation) ?? new Set();
    services.add(service);
    servicesByOperation.set(operation, services);
  }
  /** @type {Array<{ operation: string, services: string[] }>} */
  const groups = [];
  for (const [operation, services] of servicesByOperation) {
    if (services.size < minimum) continue;
    groups.push({ operation, services: [...services].sort(byCodeUnit) });
  }
  return groups.sort((a, b) => byCodeUnit(a.operation, b.operation));
}

/**
 * @param {string} a
 * @param {string} b
 */
function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const PROVIDES = 'provides';
const SERVICE = 'Service';
const CONTRACT = 'Contract';
const SHOWN_SERVICES = 8;

/** The relation types the model graph draws for `PROVIDER_VERBS` (`expose` -> `contract_exposes`). */
const PROVIDER_RELATION_TYPES = new Set(PROVIDER_VERBS.map((verb) => `contract_${verb}s`));

const cache = new WeakMap();

/**
 * The grouping for one model, built on the first operation checked and reused for the rest.
 *
 * @param {any} model
 * @returns {{ byId: Map<string, any>, providersByOperation: Map<string, string[]> }}
 */
function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const entity of model.entities ?? []) byId.set(entity.id, entity);

  const relations = model.relations ?? [];
  /** @type {Map<string, string>} contract id -> the service that provides it. */
  const serviceByContract = new Map();
  for (const relation of relations) {
    if (relation.type !== PROVIDES) continue;
    if (byId.get(relation.source)?.type !== SERVICE) continue;
    if (byId.get(relation.target)?.type !== CONTRACT) continue;
    serviceByContract.set(relation.target, relation.source);
  }

  /** @type {Array<{ operation: string, service: string }>} */
  const pairs = [];
  for (const relation of relations) {
    if (!PROVIDER_RELATION_TYPES.has(relation.type)) continue;
    const service = serviceByContract.get(relation.source);
    if (service) pairs.push({ operation: relation.target, service });
  }

  /** @type {Map<string, string[]>} */
  const providersByOperation = new Map();
  for (const group of groupByProviders(pairs)) providersByOperation.set(group.operation, group.services);

  const built = { byId, providersByOperation };
  cache.set(model, built);
  return built;
}

/** @param {any} entity */
function declaredId(entity) {
  const id = entity?.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : entity?.displayId ?? entity?.id ?? '';
}

/** @param {any} entity */
function nameOf(entity) {
  return entity?.data?.name ?? entity?.name ?? entity?.displayId ?? declaredId(entity);
}

/**
 * An operation provided by `EXPOSED_BY_MANY_THRESHOLD` or more distinct services.
 *
 * @param {any} model
 * @param {any} subject
 */
export const operationExposedByMany = (model, subject) => {
  const state = index(model);
  const providers = state.providersByOperation.get(subject.id);
  if (!providers) return { ok: true };

  const services = providers
    .map((serviceId) => state.byId.get(serviceId))
    .map((service) => ({ id: declaredId(service), name: nameOf(service) }))
    .sort((a, b) => byCodeUnit(a.id, b.id));
  const shown = services.slice(0, SHOWN_SERVICES).map((service) => `${service.id} "${service.name}"`);
  const rest = services.length - shown.length;
  return {
    ok: false,
    context: {
      operation: subject.displayId ?? declaredId(subject),
      operation_name: nameOf(subject),
      count: String(services.length),
      services: shown.join(', ') + (rest > 0 ? ` and ${rest} more` : ''),
    },
  };
};
