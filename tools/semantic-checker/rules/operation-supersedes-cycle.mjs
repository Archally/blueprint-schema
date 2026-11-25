/** Replacement cycles are checked from authored operation lists, independently of drawn edges. */
import { indexDeclarations, resolveReference } from '../validator/core/ref-resolve.mjs';

const cache = new WeakMap();

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

function replacementCycles(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const operations = model.entities.filter((entity) => entity.type === 'Operation');
  const currentIds = new Set(operations.map((operation) => operation.displayId ?? operation.data?.id));
  const subjectByHandle = new Map(operations.map((operation) => [operation.id, operation.id]));
  // History-only witnesses are reported on their existing Migration subject.
  for (const migration of model.entities.filter((entity) => entity.type === 'Migration')) {
    const retained = migration.data?._removed_operations;
    if (!Array.isArray(retained)) continue;
    for (const [index, operation] of retained.entries()) {
      if (!operation || typeof operation.id !== 'string' || currentIds.has(operation.id)) continue;
      const handle = `${migration.id}#removed-operation:${index}`;
      operations.push({ id: handle, displayId: operation.id, data: operation });
      subjectByHandle.set(handle, migration.id);
    }
  }
  const byHandle = new Map(operations.map((entity) => [entity.id, entity]));
  const declarations = [];
  for (const operation of operations) {
    const declaredId = operation.displayId ?? operation.data?.id;
    if (typeof declaredId === 'string') declarations.push({ id: declaredId, handle: operation.id });
    const key = operation.data?._operation_key;
    if (typeof key !== 'string' || !key) continue;
    const segments = (operation.fileOrigin ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
    const domain = segments.length > 1 ? segments[0] : 'default';
    const scopes = new Set([domain, operation.data?._scope].filter((scope) => typeof scope === 'string' && scope));
    for (const scope of scopes) declarations.push({ id: `${scope}:${key}`, handle: operation.id });
  }
  const references = indexDeclarations(declarations);
  const adjacency = new Map();
  for (const operation of operations) {
    const authored = operation.data?.supersedes;
    if (!Array.isArray(authored)) continue;
    const targets = new Set();
    for (const reference of authored) {
      if (typeof reference !== 'string') continue;
      const resolution = resolveReference(references, reference);
      if (resolution.status === 'resolved') targets.add(resolution.handle);
    }
    adjacency.set(operation.id, [...targets]);
  }
  const declaredId = (handle) => byHandle.get(handle)?.displayId ?? byHandle.get(handle)?.data?.id ?? handle;
  const inOrder = (left, right) => byCodeUnit(declaredId(left), declaredId(right)) || byCodeUnit(left, right);
  for (const targets of adjacency.values()) targets.sort(inOrder);
  const cycles = new Map();
  for (const component of stronglyConnectedComponents([...byHandle.keys()].sort(inOrder), adjacency)) {
    const members = component.sort(inOrder);
    const first = members[0];
    if (members.length === 1 && !(adjacency.get(first) ?? []).includes(first)) continue;
    const witness = witnessCycle(first, adjacency, new Set(members));
    const subject = subjectByHandle.get(first);
    const cycle = witness.map(declaredId).join(' -> ');
    const previous = cycles.get(subject);
    cycles.set(subject, previous ? `${previous}; ${cycle}` : cycle);
  }
  cache.set(model, cycles);
  return cycles;
}

export function operationSupersedesCycle(model, subject) {
  if (!subject || !['Operation', 'Migration'].includes(subject.type)) return { ok: true };
  const cycle = replacementCycles(model).get(subject.id);
  if (!cycle) return { ok: true };
  return { ok: false, context: { cycle } };
}
