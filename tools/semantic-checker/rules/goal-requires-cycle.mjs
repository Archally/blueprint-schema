/**
 * Legal mutual necessity, one warning per strongly connected component of two or more Goals.
 * Self-targets are reference errors, reported separately. Only goal_requires edges participate.
 * Iterative Tarjan and a sorted DFS witness avoid stack overflow and cycle enumeration.
 */
const cache = new WeakMap();

function declaredId(entity) {
  const id = entity?.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : entity?.id ?? '';
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

function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} */
  const goals = new Map();
  for (const entity of model.entities ?? []) {
    if (entity.type === 'Goal') goals.set(entity.id, entity);
  }
  const sortKey = (id) => declaredId(goals.get(id));
  const inOrder = (a, b) => byCodeUnit(sortKey(a), sortKey(b)) || byCodeUnit(a, b);

  /** @type {Map<string, string[]>} */
  const adjacency = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== 'goal_requires') continue;
    if (!goals.has(relation.source) || !goals.has(relation.target)) continue;
    const list = adjacency.get(relation.source) ?? [];
    if (!list.includes(relation.target)) list.push(relation.target);
    adjacency.set(relation.source, list);
  }
  for (const list of adjacency.values()) list.sort(inOrder);

  const nodes = [...adjacency.keys()].sort(inOrder);
  /** @type {Map<string, { members: string[], witness: string[] }>} */
  const cycles = new Map();
  for (const component of stronglyConnectedComponents(nodes, adjacency)) {
    if (component.length < 2) continue;
    const members = [...component].sort(inOrder);
    const lowest = members[0];
    cycles.set(lowest, { members, witness: witnessCycle(lowest, adjacency, new Set(members)) });
  }

  const built = { goals, cycles };
  cache.set(model, built);
  return built;
}


export const goalRequiresCycle = (model, subject) => {
  const state = index(model);
  const cycle = state.cycles.get(subject.id);
  if (!cycle) return { ok: true };
  return { ok: false, context: {
    members: cycle.members.map(id => declaredId(state.goals.get(id))).join(', '),
    witness: cycle.witness.map(id => declaredId(state.goals.get(id))).join(' -> '),
  } };
};
