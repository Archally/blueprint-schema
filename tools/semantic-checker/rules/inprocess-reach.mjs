/**
 * What starts an operation a service provides in-process.
 *
 * An in-process call has both of its ends inside the model, so an operation provided in-process
 * with nothing in the model to start it is a finding: a dead operation, or a caller nobody modelled.
 * Four things start one:
 *
 *   - ANOTHER service consumes it. A `consume:` entry is the dependency of one service on another
 *     service's in-process operation. A service listing an operation it provides itself is
 *     redundant: it states nothing, so it counts for nothing and is never reported.
 *   - It REACTS to an operation that reaches its providing service. The service hears a trigger it
 *     receives (a contract's `receive:` entry), consumes in-process when the trigger is an event,
 *     or raises: one it provides (`expose:`, `send:` or
 *     `provide:`), or one that an operation it provides `produces`. The message handler that runs
 *     the reaction is the caller, and it lives in the providing service.
 *   - An actor INITIATES it (`initiated_by`), such as a timer or a person.
 *   - An operation its providing service provides (`expose:`, `send:` or `provide:`) PRODUCES it.
 *     A domain event is the usual case: the aggregate raises it inside the service, its handlers
 *     run in the same process, and the operation that raises it is what starts it. A producer
 *     another service provides does not count: nothing in the providing service brings it about.
 *
 * Two checks read that once per model:
 *
 *   - `inprocessReactionUnreached`: an operation provided in-process that reacts to a trigger none
 *     of its providing services hears. The reaction is modelled on a service that never learns the
 *     trigger happened.
 *   - `inprocessProvideWithoutConsume`: an operation provided in-process that nothing starts and
 *     that reacts to nothing. An operation whose only reactions miss its service is left to the
 *     first check, so one gap carries one finding with its fix.
 *
 * Services are found through the contracts they provide (`provides`); a contract no service
 * provides counts as another service's, so a consumer whose owner is unknown still starts the
 * operation. A trigger that resolves to no declaration is left to the cross-reference error.
 * Services and triggers in a message are sorted by declared id in code-unit order, so the text does
 * not depend on the order the model's files were read in.
 */

import { PROVIDER_VERBS } from './operation-exposed-by-many.mjs';

const PROVIDES = 'provides';
const SERVICE = 'Service';
const CONTRACT = 'Contract';
const MISSING = 'Missing';
const IN_PROCESS_PROVIDES = 'contract_provides';
const IN_PROCESS_CONSUMES = 'contract_consumes';
const RECEIVES = 'contract_receives';
const REACTS_TO = 'reacts_to';
const INITIATED_BY = 'initiated_by';
const PRODUCES = 'produces';

/** The relation types the model graph draws for `PROVIDER_VERBS` (`expose` -> `contract_exposes`). */
const PROVIDER_RELATION_TYPES = new Set(PROVIDER_VERBS.map((verb) => `contract_${verb}s`));

/** Stands for the owner of a contract no service provides: never equal to a real service id. */
const UNKNOWN_SERVICE = Symbol('unknown service');

/**
 * @param {Map<string, Set<any>>} map
 * @param {string} key
 * @param {any} value
 */
function addTo(map, key, value) {
  const values = map.get(key) ?? new Set();
  values.add(value);
  map.set(key, values);
}

/**
 * @param {string} a
 * @param {string} b
 */
function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const cache = new WeakMap();

/**
 * The reach of every service, and the in-process providers and consumers of every operation, built
 * on the first operation checked and reused for the rest.
 *
 * @param {any} model
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

  /** @type {Map<string, Set<string>>} operation -> the services that provide it in-process. */
  const inProcessProviders = new Map();
  /** @type {Map<string, Set<string | symbol>>} operation -> the services that consume it in-process. */
  const inProcessConsumers = new Map();
  /** @type {Map<string, Set<string>>} service -> the operations it provides, under any provider verb. */
  const providedBy = new Map();
  /** @type {Map<string, Set<string>>} service -> the operations it hears. */
  const heardBy = new Map();
  /** @type {Map<string, Set<string>>} service -> what the operations it provides produce. */
  const raisedBy = new Map();
  /** @type {Map<string, Set<string>>} operation -> what it produces. */
  const products = new Map();
  /** @type {Map<string, Set<string>>} operation -> the operations it reacts to. */
  const triggers = new Map();
  /** @type {Set<string>} operations an actor initiates. */
  const initiated = new Set();

  for (const relation of relations) {
    const owner = serviceByContract.get(relation.source);
    if (relation.type === IN_PROCESS_PROVIDES && owner) addTo(inProcessProviders, relation.target, owner);
    if (relation.type === IN_PROCESS_CONSUMES) addTo(inProcessConsumers, relation.target, owner ?? UNKNOWN_SERVICE);
    if (PROVIDER_RELATION_TYPES.has(relation.type) && owner) addTo(providedBy, owner, relation.target);
    if (owner && (relation.type === RECEIVES || (
      relation.type === IN_PROCESS_CONSUMES && byId.get(relation.target)?.data?.kind === 'event'
    ))) addTo(heardBy, owner, relation.target);
    if (relation.type === PRODUCES) addTo(products, relation.source, relation.target);
    if (relation.type === REACTS_TO) addTo(triggers, relation.source, relation.target);
    if (relation.type === INITIATED_BY) initiated.add(relation.source);
  }

  // A service also hears what it provides and what those operations produce.
  for (const [service, operations] of providedBy) {
    for (const operation of operations) {
      addTo(heardBy, service, operation);
      for (const product of products.get(operation) ?? []) {
        addTo(heardBy, service, product);
        if (product !== operation) addTo(raisedBy, service, product);
      }
    }
  }

  const built = { byId, inProcessProviders, inProcessConsumers, heardBy, raisedBy, triggers, initiated };
  cache.set(model, built);
  return built;
}

/**
 * @param {ReturnType<typeof index>} state
 * @param {string} operation
 * @param {Set<string>} providers
 */
function unreachedTriggers(state, operation, providers) {
  /** @type {string[]} */
  const unreached = [];
  for (const trigger of state.triggers.get(operation) ?? []) {
    if (state.byId.get(trigger)?.type === MISSING) continue;
    const reached = [...providers].some((service) => state.heardBy.get(service)?.has(trigger));
    if (!reached) unreached.push(trigger);
  }
  return unreached;
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
 * An operation provided in-process that nothing in the model starts: no other service consumes it,
 * no operation its providing service provides produces it, it reacts to no operation, and no actor
 * initiates it. An operation whose reactions all miss its providing services is reported by
 * `inprocessReactionUnreached` instead.
 *
 * @param {any} model
 * @param {any} subject
 */
export const inprocessProvideWithoutConsume = (model, subject) => {
  const state = index(model);
  const providers = state.inProcessProviders.get(subject.id);
  if (!providers) return { ok: true };

  if (state.initiated.has(subject.id)) return { ok: true };

  // Raised inside a providing service: an operation that service provides produces it.
  if ([...providers].some((service) => state.raisedBy.get(service)?.has(subject.id))) return { ok: true };

  for (const consumer of state.inProcessConsumers.get(subject.id) ?? []) {
    // Another service: one that is not the only provider. A service consuming what it provides
    // itself states nothing.
    if (typeof consumer !== 'string' || [...providers].some((provider) => provider !== consumer)) {
      return { ok: true };
    }
  }

  // A reaction that reaches a providing service starts the operation. One that reaches none is
  // reported by `inprocessReactionUnreached`, which names the trigger and the fix, so this check
  // leaves it there and one gap is reported once. A reaction to a trigger that resolves to no
  // declaration starts nothing.
  for (const trigger of state.triggers.get(subject.id) ?? []) {
    if (state.byId.get(trigger)?.type !== MISSING) return { ok: true };
  }

  return { ok: false };
};

/**
 * An operation provided in-process that reacts to a trigger none of its providing services hears.
 *
 * @param {any} model
 * @param {any} subject
 */
export const inprocessReactionUnreached = (model, subject) => {
  const state = index(model);
  const providers = state.inProcessProviders.get(subject.id);
  if (!providers) return { ok: true };

  const unreached = unreachedTriggers(state, subject.id, providers);
  if (unreached.length === 0) return { ok: true };

  const triggerIds = unreached.map((trigger) => declaredId(state.byId.get(trigger))).sort(byCodeUnit);
  const services = [...providers]
    .map((serviceId) => state.byId.get(serviceId))
    .map((service) => ({ id: declaredId(service), name: nameOf(service) }))
    .sort((a, b) => byCodeUnit(a.id, b.id))
    .map((service) => `${service.id} "${service.name}"`);
  return {
    ok: false,
    context: {
      trigger: triggerIds.join('", "'),
      service: services.join(', '),
    },
  };
};
