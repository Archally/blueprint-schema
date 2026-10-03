/**
 * A cycle among `imports` edges.
 *
 * `imports` names the libraries a service is built on, and the model builder draws one
 * `service_imports` edge per resolved item. A build cannot finish when A needs B built first and B
 * needs A built first, so a cycle among those edges is a layering defect with one fix: break it.
 * A service importing itself is the shortest such cycle and is reported the same way.
 *
 * A cycle among `uses` edges is NOT read here, and nothing reports it: two running services may
 * depend on each other by design (a callback, a webhook, an orchestrator and its participant), so
 * such a cycle has no fix to offer.
 *
 * THE UNIT IS A STRONGLY CONNECTED COMPONENT, not a ring. A component can hold several cycles
 * (A -> B -> A and A -> C -> A), and listing each would report one defect many times. So:
 *
 *   - one finding per component of two or more services, and one per service importing itself;
 *   - the finding attaches to the component's LOWEST declared id, and every other member yields
 *     none (the engine runs once per service);
 *   - the message lists the members sorted by declared id, plus ONE witness cycle found by a
 *     depth-first walk from the lowest id that takes neighbours in id order, so the text is the same
 *     on every run however many cycles the component holds.
 *
 * Self-contained on purpose: the strongly connected components are computed here (Tarjan's
 * algorithm, iterative so a long chain cannot exhaust the stack) rather than imported, so the rule
 * module resolves wherever the rule pack is deployed.
 */

const IMPORTS = 'service_imports';
const SERVICE = 'Service';

const cache = new WeakMap();

function declaredId(entity) {
  const id = entity?.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : entity?.id ?? '';
}

function nameOf(entity) {
  return entity?.data?.name ?? entity?.name ?? entity?.displayId ?? declaredId(entity);
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Strongly connected components of a directed graph, iterative Tarjan.
 * `nodes` and every adjacency list are already in the order the walk should take.
 * @param {string[]} nodes
 * @param {Map<string, string[]>} adjacency
 * @returns {string[][]}
 */
function stronglyConnectedComponents(nodes, adjacency) {
  const indexOf = new Map();
  const lowLink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  for (const root of nodes) {
    if (indexOf.has(root)) continue;
    /** Each frame: the node and the position of the next neighbour to visit. */
    const frames = [{ node: root, next: 0 }];
    indexOf.set(root, counter);
    lowLink.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next];
        frame.next += 1;
        if (!indexOf.has(neighbour)) {
          indexOf.set(neighbour, counter);
          lowLink.set(neighbour, counter);
          counter += 1;
          stack.push(neighbour);
          onStack.add(neighbour);
          frames.push({ node: neighbour, next: 0 });
        } else if (onStack.has(neighbour)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node), indexOf.get(neighbour)));
        }
        continue;
      }

      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].node;
        lowLink.set(parent, Math.min(lowLink.get(parent), lowLink.get(frame.node)));
      }
      if (lowLink.get(frame.node) === indexOf.get(frame.node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }
    }
  }
  return components;
}

/**
 * The first cycle back to `start` that a depth-first walk finds, taking neighbours in the order
 * given and staying inside `members`. Every node of a strongly connected component lies on a cycle
 * through any other, so the walk always finds one.
 */
function witnessCycle(start, adjacency, members) {
  const path = [start];
  const visited = new Set([start]);
  const frames = [{ node: start, next: 0 }];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    const neighbours = (adjacency.get(frame.node) ?? []).filter((node) => members.has(node));
    if (frame.next >= neighbours.length) {
      frames.pop();
      path.pop();
      continue;
    }
    const neighbour = neighbours[frame.next];
    frame.next += 1;
    if (neighbour === start) return [...path, start];
    if (visited.has(neighbour)) continue;
    visited.add(neighbour);
    path.push(neighbour);
    frames.push({ node: neighbour, next: 0 });
  }
  return [start, start];
}

/** service entity id -> its cycle, for the lowest-id member of each cyclic component only. */
function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} */
  const services = new Map();
  for (const entity of model.entities ?? []) {
    if (entity.type === SERVICE) services.set(entity.id, entity);
  }
  const sortKey = (id) => declaredId(services.get(id));
  const inOrder = (a, b) => byCodeUnit(sortKey(a), sortKey(b)) || byCodeUnit(a, b);

  /** @type {Map<string, string[]>} */
  const adjacency = new Map();
  const selfLoops = new Set();
  for (const relation of model.relations ?? []) {
    if (relation.type !== IMPORTS) continue;
    if (!services.has(relation.source) || !services.has(relation.target)) continue;
    if (relation.source === relation.target) selfLoops.add(relation.source);
    const list = adjacency.get(relation.source) ?? [];
    if (!list.includes(relation.target)) list.push(relation.target);
    adjacency.set(relation.source, list);
  }
  for (const list of adjacency.values()) list.sort(inOrder);

  const nodes = [...adjacency.keys()].sort(inOrder);
  /** @type {Map<string, { members: string[], witness: string[] }>} */
  const cycles = new Map();
  for (const component of stronglyConnectedComponents(nodes, adjacency)) {
    if (component.length < 2 && !selfLoops.has(component[0])) continue;
    const members = [...component].sort(inOrder);
    const lowest = members[0];
    cycles.set(lowest, { members, witness: witnessCycle(lowest, adjacency, new Set(members)) });
  }

  const built = { services, cycles };
  cache.set(model, built);
  return built;
}

/** A strongly connected component of `imports` edges, reported on its lowest-id member. */
export const importsCycle = (model, subject) => {
  const state = index(model);
  const cycle = state.cycles.get(subject.id);
  if (!cycle) return { ok: true };

  const label = (id) => {
    const service = state.services.get(id);
    return `${declaredId(service)} "${nameOf(service)}"`;
  };
  const witness = cycle.witness.map((id) => declaredId(state.services.get(id))).join(' -> ');
  const self = cycle.members.length === 1;
  const statement = self
    ? `Service ${label(cycle.members[0])} imports itself (${witness})`
    : `Services ${cycle.members.map(label).join(', ')} import one another (${witness})`;
  const fix = self
    ? 'A service cannot be built on itself: remove the item from its `imports`.'
    : 'A build cannot finish when each needs another built first: move what they share into a library both import, or state a direction that is a call made while running in `uses` or the contracts.';

  return {
    ok: false,
    context: {
      cycle: statement,
      fix,
      members: cycle.members.map((id) => declaredId(state.services.get(id))).join(', '),
      witness,
    },
  };
};
