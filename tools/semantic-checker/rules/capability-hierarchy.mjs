/**
 * The capability hierarchy of a model, and the operations each capability realizes, read once per
 * model for the capability rules.
 *
 * A capability decomposes into the capabilities nested under its `children`; the graph carries
 * each as its own entity, and this module joins a child back to its parent by the child entity's
 * own `data` (the nested object), or, where that is not the same object, by its file and declared
 * id. A child declared twice in one file is joined to every capability that declares it, and a
 * malformed hierarchy is bounded by a visited set during nesting diagnostics. Realization reads
 * only a root and its direct children; deeper declarations are judged independently.
 *
 * The operations a capability realizes are the targets of its `capability_operation` edges that are
 * Operations. An edge to a placeholder (a listing that resolves to nothing, or to several
 * entities) or to an entity of another type realizes nothing.
 */

const CAPABILITY = 'Capability';
const OPERATION = 'Operation';
const CAPABILITY_OPERATION = 'capability_operation';

const cache = new WeakMap();

/**
 * @typedef {object} CapabilityIndex
 * @property {Map<string, any>} byId every entity by internal id
 * @property {any[]} capabilities every Capability entity, sorted by declared id then internal id
 * @property {Map<string, Set<string>>} parents L2 capability id -> its direct L1 parents
 * @property {Map<string, Set<string>>} children L1 capability id -> its direct L2 children
 * @property {Map<string, {parent: string, root: string}>} deeper capabilities nested beyond two levels
 * @property {Map<string, Map<string, string>>} capabilitiesByOperation operation id -> capability id -> origin
 * @property {Map<string, Set<string>>} operationsByCapability capability id -> the operations it realizes
 */

/**
 * @param {any} model
 * @returns {CapabilityIndex}
 */
export function capabilityIndex(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const entity of model.entities ?? []) byId.set(entity.id, entity);

  const capabilities = [...byId.values()]
    .filter((entity) => entity.type === CAPABILITY)
    .sort((a, b) => byCodeUnit(declaredId(a), declaredId(b)) || byCodeUnit(a.id, b.id));

  /** @type {Map<unknown, string>} */
  const byData = new Map();
  /** @type {Map<string, string[]>} */
  const byFileAndId = new Map();
  for (const capability of capabilities) {
    if (capability.data && typeof capability.data === 'object') byData.set(capability.data, capability.id);
    const key = `${capability.fileOrigin ?? ''}\u0000${declaredId(capability)}`;
    const bucket = byFileAndId.get(key) ?? [];
    bucket.push(capability.id);
    byFileAndId.set(key, bucket);
  }

  /** @type {Map<string, Set<string>>} */
  const declaredParents = new Map();
  /** @type {Map<string, Set<string>>} */
  const declaredChildren = new Map();
  for (const capability of capabilities) {
    const nested = capability.data?.children;
    if (!Array.isArray(nested)) continue;
    for (const child of nested) {
      if (!child || typeof child !== 'object' || child.id == null) continue;
      const same = byData.get(child);
      const childIds = same ? [same] : byFileAndId.get(`${capability.fileOrigin ?? ''}\u0000${String(child.id)}`) ?? [];
      for (const childId of childIds) {
        if (childId === capability.id) continue;
        addTo(declaredParents, childId, capability.id);
        addTo(declaredChildren, capability.id, childId);
      }
    }
  }

  /** @type {Map<string, Set<string>>} */
  const parents = new Map();
  /** @type {Map<string, Set<string>>} */
  const children = new Map();
  /** @type {Map<string, {parent: string, root: string}>} */
  const deeper = new Map();
  const roots = capabilities.filter((capability) => !declaredParents.has(capability.id));
  for (const root of roots) {
    for (const child of declaredChildren.get(root.id) ?? []) {
      addTo(parents, child, root.id);
      addTo(children, root.id, child);
    }
    // Only diagnostics follow deeper declarations. They never enter the realization hierarchy.
    const seen = new Set([root.id]);
    const queue = [{ id: root.id, depth: 1 }];
    for (let position = 0; position < queue.length; position++) {
      const current = queue[position];
      for (const child of declaredChildren.get(current.id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        if (current.depth >= 2 && !deeper.has(child)) deeper.set(child, { parent: current.id, root: root.id });
        queue.push({ id: child, depth: current.depth + 1 });
      }
    }
  }

  /** @type {Map<string, Map<string, string>>} */
  const capabilitiesByOperation = new Map();
  /** @type {Map<string, Set<string>>} */
  const operationsByCapability = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== CAPABILITY_OPERATION) continue;
    if (byId.get(relation.source)?.type !== CAPABILITY) continue;
    if (byId.get(relation.target)?.type !== OPERATION) continue;
    const origin = typeof relation.data?.origin === 'string' ? relation.data.origin : 'operation';
    const bucket = capabilitiesByOperation.get(relation.target) ?? new Map();
    bucket.set(relation.source, origin);
    capabilitiesByOperation.set(relation.target, bucket);
    addTo(operationsByCapability, relation.source, relation.target);
  }

  const built = { byId, capabilities, parents, children, deeper, capabilitiesByOperation, operationsByCapability };
  cache.set(model, built);
  return built;
}

/** The direct L1 parent only; deeper declarations have no realization parent.
 * @param {CapabilityIndex} index
 * @param {string} capabilityId
 * @returns {Set<string>}
 */
export function ancestorsOf(index, capabilityId) {
  return new Set(index.parents.get(capabilityId) ?? []);
}

/** The direct children of an L1 only; every other capability is judged alone.
 * @param {CapabilityIndex} index
 * @param {string} capabilityId
 * @returns {Set<string>}
 */
export function descendantsOf(index, capabilityId) {
  return new Set(index.children.get(capabilityId) ?? []);
}

/**
 * @param {Map<string, Set<string>>} map
 * @param {string} key
 * @param {string} value
 */
function addTo(map, key, value) {
  const bucket = map.get(key) ?? new Set();
  bucket.add(value);
  map.set(key, bucket);
}

/** @param {any} entity */
export function declaredId(entity) {
  const id = entity?.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : entity?.displayId ?? entity?.id ?? '';
}

/** @param {any} entity */
export function nameOf(entity) {
  return entity?.data?.name ?? entity?.name ?? entity?.displayId ?? declaredId(entity);
}

/**
 * @param {string} a
 * @param {string} b
 */
export function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
