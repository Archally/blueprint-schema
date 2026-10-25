/**
 * A capability whose subtree - an L1 and its direct children, or any other capability alone - realizes no operation,
 * reported once at the topmost such capability.
 *
 * A capability realizes an operation where the model graph draws a `capability_operation` edge from
 * it to an Operation. Edges to placeholders do not count: a listing that resolves to nothing realizes
 * nothing. A capability is reported when its subtree realizes nothing and no direct L1 parent
 * has an empty two-level scope too, so an unwired level-1 capability with eight children is one finding.
 *
 * The message says why the subtree is empty, from what its capabilities state:
 *   - nothing listed and no module named;
 *   - listed operations that resolve to no operation;
 *   - `realized_in` entries that resolve to no domain or bounded context;
 *   - named modules that hold no operation (no operation's document names the domain, no service
 *     of the bounded context provides one);
 *   - named modules whose every operation some capability lists, which displaces the module default.
 *
 * INFO, not a defect: a capability map is often written before it is wired to the model. The
 * finding makes the absence countable.
 */
import { ancestorsOf, capabilityIndex, declaredId, descendantsOf, nameOf } from './capability-hierarchy.mjs';

const CAPABILITY_REALIZED_IN = 'capability_realized_in';
const MODULE_TYPES = new Set(['Domain', 'Context']);
const MODULE_MEMBERSHIP = new Set(['operation_in_domain', 'handled_by']);

const cache = new WeakMap();

/**
 * Per model: which capabilities have an empty subtree, what each states, and how many operations
 * each module holds.
 *
 * @param {any} model
 */
function realizationIndex(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const index = capabilityIndex(model);

  /** @type {Map<string, string[]>} capability id -> the targets of its realized_in edges */
  const modulesByCapability = new Map();
  /** @type {Map<string, number>} module id -> the operations it holds */
  const operationsByModule = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type === CAPABILITY_REALIZED_IN) {
      const bucket = modulesByCapability.get(relation.source) ?? [];
      bucket.push(relation.target);
      modulesByCapability.set(relation.source, bucket);
    } else if (MODULE_MEMBERSHIP.has(relation.type) && index.byId.get(relation.source)?.type === 'Operation') {
      operationsByModule.set(relation.target, (operationsByModule.get(relation.target) ?? 0) + 1);
    }
  }

  /** @type {Map<string, boolean>} */
  const emptySubtree = new Map();
  for (const capability of index.capabilities) {
    const members = [capability.id, ...descendantsOf(index, capability.id)];
    emptySubtree.set(capability.id, members.every((id) => !(index.operationsByCapability.get(id)?.size)));
  }

  const built = { index, modulesByCapability, operationsByModule, emptySubtree };
  cache.set(model, built);
  return built;
}

/**
 * Why a subtree realizes nothing, from what its capabilities state.
 *
 * @param {ReturnType<typeof realizationIndex>} state
 * @param {string[]} members
 */
function reasons(state, members) {
  let listings = 0;
  /** @type {Set<string>} */
  const unresolved = new Set();
  /** @type {Set<string>} */
  const empty = new Set();
  /** @type {Set<string>} */
  const displaced = new Set();
  for (const id of members) {
    const operations = state.index.byId.get(id)?.data?.operations;
    if (Array.isArray(operations)) {
      listings += new Set(operations.filter((ref) => typeof ref === 'string' && ref.length > 0)).size;
    }
    for (const target of state.modulesByCapability.get(id) ?? []) {
      if (!MODULE_TYPES.has(state.index.byId.get(target)?.type)) unresolved.add(target);
      else if (!state.operationsByModule.get(target)) empty.add(target);
      else displaced.add(target);
    }
  }

  const named = unresolved.size + empty.size + displaced.size;
  if (listings === 0 && named === 0) return 'no capability in it lists an operation or names a module in realized_in';
  /** @type {string[]} */
  const parts = [];
  if (listings > 0) parts.push(`${listings} listed operation${listings === 1 ? '' : 's'} resolve${listings === 1 ? 's' : ''} to no operation`);
  if (unresolved.size > 0) parts.push(`${plural(unresolved.size, 'module')} in realized_in resolve${unresolved.size === 1 ? 's' : ''} to no domain or bounded context`);
  if (empty.size > 0) parts.push(`${plural(empty.size, 'module')} in realized_in hold${empty.size === 1 ? 's' : ''} no operation`);
  if (displaced.size > 0) {
    parts.push(`every operation of ${plural(displaced.size, 'module')} in realized_in is listed under some capability, which displaces the module default`);
  }
  return parts.join('; ');
}

/**
 * @param {number} count
 * @param {string} noun
 */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * @param {any} model
 * @param {any} subject
 */
export const capabilityRealizedNowhere = (model, subject) => {
  const state = realizationIndex(model);
  if (!state.emptySubtree.get(subject.id)) return { ok: true };
  for (const ancestor of ancestorsOf(state.index, subject.id)) {
    if (state.emptySubtree.get(ancestor)) return { ok: true };
  }

  const descendants = [...descendantsOf(state.index, subject.id)];
  const level = subject.data?.level;
  return {
    ok: false,
    context: {
      capability: declaredId(subject),
      capability_name: nameOf(subject),
      level: level === undefined || level === null ? 'unstated' : String(level),
      scope:
        descendants.length === 0
          ? 'and it has no sub-capabilities'
          : descendants.length === 1
            ? 'nor does its 1 sub-capability'
            : `nor does any of its ${descendants.length} sub-capabilities`,
      reason: reasons(state, [subject.id, ...descendants]),
    },
  };
};
