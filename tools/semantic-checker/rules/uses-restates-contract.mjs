/**
 * A `uses` item the contracts already state.
 *
 * `uses` names the services a service depends on while running, at the level of a container
 * diagram, and is the statement to make before the contracts between the two are written. Once
 * they are written, the contracts say the same thing with more in it: which operations, in which
 * direction, over which transport. This check finds a `uses` item A -> B where some operation O is
 * both CONSUMED by a contract A provides (`contract_calls`, `contract_receives`,
 * `contract_consumes`) and PROVIDED by a contract B provides (`contract_exposes`, `contract_sends`,
 * `contract_provides`).
 *
 * A SHARED STORE DOES NOT STATE A `uses`. Reading data B writes (`contract_reads` against
 * `contract_writes`) makes A depend on the data and on the store that holds it, not on B running,
 * so a store pair never satisfies the join.
 *
 * SILENT WHEN THE TARGET STATES `kind: library`. That item is `uses-target-is-library`'s, whose fix
 * (move it to `imports`) keeps the build dependency; reporting it here as well would suggest
 * deleting it. One item gets one finding, with one fix.
 *
 * `imports` is never compared with contracts: an in-process contract says which operations A calls
 * in B, `imports` says that A's build contains B, and the two statements do not duplicate each
 * other.
 *
 * INFO, not a defect: a restated `uses` is true, only redundant. One finding per service, naming
 * each restated target with up to three of the operations that state it, sorted by id.
 */

const USES = 'service_uses';
const PROVIDES = 'provides';
const SERVICE = 'Service';
const CONTRACT = 'Contract';
const LIBRARY = 'library';
const SHOWN_OPERATIONS = 3;

const CONSUMER_VERBS = new Set(['contract_calls', 'contract_receives', 'contract_consumes']);
const PROVIDER_VERBS = new Set(['contract_exposes', 'contract_sends', 'contract_provides']);

const cache = new WeakMap();

const addTo = (map, key, value) => {
  const set = map.get(key) ?? new Set();
  set.add(value);
  map.set(key, set);
};

function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} every entity by id. */
  const byId = new Map();
  for (const entity of model.entities ?? []) byId.set(entity.id, entity);

  /** @type {Map<string, string>} contract id -> the service that provides it. */
  const serviceByContract = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== PROVIDES) continue;
    if (byId.get(relation.source)?.type !== SERVICE) continue;
    if (byId.get(relation.target)?.type !== CONTRACT) continue;
    serviceByContract.set(relation.target, relation.source);
  }

  /** @type {Map<string, Set<string>>} service id -> operations its contracts consume / provide. */
  const consumed = new Map();
  const provided = new Map();
  /** @type {Map<string, Set<string>>} service id -> the services it names in `uses`. */
  const uses = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type === USES) {
      addTo(uses, relation.source, relation.target);
      continue;
    }
    const consumer = CONSUMER_VERBS.has(relation.type);
    if (!consumer && !PROVIDER_VERBS.has(relation.type)) continue;
    const serviceId = serviceByContract.get(relation.source);
    if (!serviceId) continue;
    addTo(consumer ? consumed : provided, serviceId, relation.target);
  }

  const built = { byId, consumed, provided, uses };
  cache.set(model, built);
  return built;
}

function declaredId(entity) {
  const id = entity?.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : entity?.displayId ?? entity?.id ?? '';
}

function nameOf(entity) {
  return entity?.data?.name ?? entity?.name ?? entity?.displayId ?? declaredId(entity);
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A `uses` item A -> B that the contracts between A and B already state. */
export const usesRestatesContract = (model, subject) => {
  const state = index(model);
  const targets = state.uses.get(subject.id);
  if (!targets) return { ok: true };
  const consumed = state.consumed.get(subject.id);
  if (!consumed) return { ok: true };

  const restated = [];
  for (const targetId of targets) {
    if (targetId === subject.id) continue;
    const target = state.byId.get(targetId);
    if (target?.data?.kind === LIBRARY) continue;
    const provided = state.provided.get(targetId);
    if (!provided) continue;
    const operations = [...consumed]
      .filter((operationId) => provided.has(operationId))
      .map((operationId) => declaredId(state.byId.get(operationId)) || operationId)
      .sort(byCodeUnit);
    if (operations.length === 0) continue;
    const shown = operations.slice(0, SHOWN_OPERATIONS).join(', ');
    const more = operations.length > SHOWN_OPERATIONS ? ` and ${operations.length - SHOWN_OPERATIONS} more` : '';
    restated.push({
      id: declaredId(target),
      label: `${declaredId(target)} "${nameOf(target)}" through ${shown}${more}`,
    });
  }
  if (restated.length === 0) return { ok: true };

  restated.sort((a, b) => byCodeUnit(a.id, b.id));
  return {
    ok: false,
    context: {
      service: declaredId(subject),
      service_name: nameOf(subject),
      restated: restated.map((item) => item.label).join('; '),
    },
  };
};
