/**
 * A shared store is an integration only if both ends reach the same store.
 *
 * `shareddata` declares that one service writes data another reads. That is a statement about the
 * solution side, and the solution side is also modelled: a service names what it runs on with
 * `resource_refs` (IR### instances) or with `needs` (the type-level requirement a binding resolves
 * per environment). Where both services name theirs AT THE SAME LEVEL and the two lists have
 * nothing in common, the model says two things - the contract says they share a store, and the
 * infrastructure says they do not touch the same one.
 *
 * VERIFICATION, NEVER INFERENCE. This check never concludes a shared store FROM infrastructure: two
 * services naming one resource is an ordinary and usually innocent fact - a logging sink, a cache, a
 * broker another contract kind already owns. It only checks a declaration the author already made.
 *
 * SILENT WHERE THERE IS NOTHING TO COMPARE. A service that names no infrastructure at all is not
 * contradicting anything; it is a model whose infrastructure layer has not been written, which is
 * legitimate and common. Firing there would report the absence of a layer rather than a
 * disagreement, and would fire on every model that has not built one. Two services naming theirs at
 * DIFFERENT levels are in the same position - `IR001` and `orders-db` are not two answers to one
 * question.
 */

const PROVIDES = 'provides';
const WRITES = 'contract_writes';
const READS = 'contract_reads';
const KIND = 'shareddata';

const cache = new WeakMap();

function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} every entity by id, for the service and contract lookups below. */
  const byId = new Map();
  for (const entity of model.entities ?? []) byId.set(entity.id, entity);

  /** @type {Map<string, string>} contract id -> the service that provides it. */
  const serviceByContract = new Map();
  /** @type {Map<string, Set<string>>} contract id -> the operations it writes / reads. */
  const writes = new Map();
  const reads = new Map();
  /** @type {Map<string, Set<string>>} operation id -> the contracts writing / reading it. */
  const writersByOp = new Map();
  const readersByOp = new Map();

  const add = (map, key, value) => {
    const set = map.get(key) ?? new Set();
    set.add(value);
    map.set(key, set);
  };

  for (const relation of model.relations ?? []) {
    if (relation.type === PROVIDES) {
      const target = byId.get(relation.target);
      if (target?.type === 'Contract') serviceByContract.set(relation.target, relation.source);
    } else if (relation.type === WRITES) {
      add(writes, relation.source, relation.target);
      add(writersByOp, relation.target, relation.source);
    } else if (relation.type === READS) {
      add(reads, relation.source, relation.target);
      add(readersByOp, relation.target, relation.source);
    }
  }

  const built = { byId, serviceByContract, writes, reads, writersByOp, readersByOp };
  cache.set(model, built);
  return built;
}

/**
 * The infrastructure a contract's own service names, with the ALTITUDE it named it at.
 *
 * A service declares what it runs on at one of two levels and they are not interchangeable:
 * `resource_refs` names IR### instances, `needs` names the type-level requirement a binding
 * resolves to an instance per environment. Two services are only comparable at the same level -
 * one naming `IR001` and another naming `orders-db` are not disagreeing, they are describing
 * different rungs of the same ladder. Where a service declares both, the instance wins: it is the
 * more specific statement and the one a binding would have produced.
 *
 * Returns null when the service names neither, which is a model whose infrastructure layer has not
 * been written rather than a contradiction.
 */
function resourcesOf(state, contractId) {
  const serviceId = state.serviceByContract.get(contractId);
  if (!serviceId) return null;
  const data = state.byId.get(serviceId)?.data;

  const refs = data?.resource_refs;
  if (Array.isArray(refs)) {
    const ids = refs.filter((ref) => typeof ref === 'string' && ref.length > 0);
    if (ids.length > 0) return { altitude: 'resource_refs', ids: new Set(ids) };
  }

  const needs = data?.needs;
  if (Array.isArray(needs)) {
    const ids = needs
      .map((need) => (need && typeof need === 'object' ? need.id : undefined))
      .filter((id) => typeof id === 'string' && id.length > 0);
    if (ids.length > 0) return { altitude: 'needs', ids: new Set(ids) };
  }

  return null;
}

function nameOf(state, contractId) {
  const serviceId = state.serviceByContract.get(contractId);
  const service = serviceId ? state.byId.get(serviceId) : undefined;
  return service?.data?.name ?? service?.displayId ?? service?.name ?? serviceId ?? 'a service';
}

const isSharedData = (entity) => entity?.data?._contractType === KIND;

/**
 * A `shareddata` contract whose counterpart reaches a different set of resources than it does.
 *
 * Reported from whichever end the engine hands us, and both ends see the same disagreement, so the
 * message names the counterpart rather than claiming one side is wrong. Which of the two is wrong
 * is exactly what this check cannot know.
 */
export const sharedStoreWithoutCommonResource = (model, subject) => {
  if (!isSharedData(subject)) return { ok: true };
  const state = index(model);

  const mine = resourcesOf(state, subject.id);
  if (!mine) return { ok: true };

  /** Counterparts: whoever reads what I write, and whoever writes what I read. */
  const counterparts = new Set();
  for (const op of state.writes.get(subject.id) ?? []) {
    for (const other of state.readersByOp.get(op) ?? []) counterparts.add(other);
  }
  for (const op of state.reads.get(subject.id) ?? []) {
    for (const other of state.writersByOp.get(op) ?? []) counterparts.add(other);
  }
  counterparts.delete(subject.id);

  const disjoint = [];
  for (const other of counterparts) {
    if (!isSharedData(state.byId.get(other))) continue;
    const theirs = resourcesOf(state, other);
    if (!theirs) continue;
    // Different rungs of the ladder are not a disagreement - there is nothing to compare.
    if (theirs.altitude !== mine.altitude) continue;
    if ([...theirs.ids].some((ref) => mine.ids.has(ref))) continue;
    disjoint.push(other);
  }

  if (disjoint.length === 0) return { ok: true };

  return {
    ok: false,
    context: {
      subject: subject.displayId ?? subject.id,
      subject_name: nameOf(state, subject.id),
      counterparts: disjoint.map((id) => nameOf(state, id)).sort().join(', '),
      resources: [...mine.ids].sort().join(', '),
      altitude: mine.altitude,
    },
  };
};
