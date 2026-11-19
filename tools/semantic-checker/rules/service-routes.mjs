/** Authored forwarding completeness and target advice. Reference validity is checked separately. */
const list = value => Array.isArray(value) ? value : [];
const declaredId = entity => entity.data?.id ?? entity.displayId ?? entity.id;
const findings = problems => ({ ok: problems.length === 0, context: { findings: problems.join('; ') } });

// Built models are immutable during a checker run. Index once for all service subjects.
const cache = new WeakMap();
function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const byId = new Map(model.entities.map(entity => [entity.id, entity]));
  const bySource = new Map();
  for (const relation of model.relations) {
    const outgoing = bySource.get(relation.source) ?? [];
    outgoing.push(relation);
    bySource.set(relation.source, outgoing);
  }
  const built = { byId, bySource };
  cache.set(model, built);
  return built;
}

/** A partial model with an authored target is different from one naming no targets. */
export function gatewayWithoutRoute(_model, subject) {
  const role = subject.data?.role;
  if (!['gateway', 'bff'].includes(role)) return { ok: true };
  if (list(subject.data?.routes_to).length > 0) return { ok: true };
  return findings([`${declaredId(subject)} has role ${role} and names no routes_to targets. State the backend services it forwards requests to.`]);
}

/** Read resolved forwarding only, preserving missing/ambiguous references for validation. */
export function routesTargetIsLibrary(model, subject) {
  const { byId, bySource } = index(model);
  const targets = new Set();
  for (const relation of bySource.get(subject.id) ?? []) {
    if (relation.type !== 'routes_to') continue;
    const target = byId.get(relation.target);
    if (target?.type !== 'Service') continue;
    if (target.data?.kind !== 'library') continue;
    targets.add(declaredId(target));
  }
  return findings([...targets].sort().map(target => `${declaredId(subject)} routes_to ${target}, whose stated kind is library. A library is built into its host; check the route target and use imports for a build dependency.`));
}

/** One subject finding names every overlapping uses entry, with its zero-based source position. */
export function routesRestatesUses(model, subject) {
  const { byId, bySource } = index(model);
  const routed = new Set();
  const used = new Set();
  for (const relation of bySource.get(subject.id) ?? []) {
    if (byId.get(relation.target)?.type !== 'Service') continue;
    if (relation.type === 'routes_to') routed.add(relation.target);
    if (relation.type === 'service_uses') used.add(relation.target);
  }
  const overlap = new Set([...routed].filter(target => used.has(target)).map(target => declaredId(byId.get(target))));
  const problems = [];
  for (const [position, reference] of list(subject.data?.uses).entries()) {
    if (!overlap.has(reference)) continue;
    problems.push(`${declaredId(subject)} uses[${position}] names ${reference}, already named in routes_to. Drop this uses entry; forwarding already states the dependency.`);
  }
  return findings(problems);
}
