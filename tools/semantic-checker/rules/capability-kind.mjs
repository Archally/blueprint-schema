/** Kind follows declaration nesting, independently of the L1/L2 realization index. */
import { declaredId } from './capability-hierarchy.mjs';

const cache = new WeakMap();
// The model builder extracts depth 0 through 10. Do not recurse into unextracted declarations.
const MAX_DEPTH = 10;

/** @param {any} model @returns {Map<string, string[]>} */
function violationsByEntity(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const capabilities = (model.entities ?? []).filter((entity) => entity.type === 'Capability');
  const byData = new Map();
  const byFileAndId = new Map();
  for (const entity of capabilities) {
    const same = byData.get(entity.data) ?? [];
    same.push(entity);
    byData.set(entity.data, same);
    const key = `${entity.fileOrigin ?? ''}\u0000${declaredId(entity)}`;
    const declarations = byFileAndId.get(key) ?? [];
    declarations.push(entity);
    byFileAndId.set(key, declarations);
  }
  const matches = (data, file) => byData.get(data)
    ?? byFileAndId.get(`${file}\u0000${String(data.id)}`) ?? [];
  const nested = new Set();
  for (const entity of capabilities) {
    for (const child of Array.isArray(entity.data?.children) ? entity.data.children : []) {
      if (!child || typeof child !== 'object') continue;
      for (const target of matches(child, entity.fileOrigin ?? '')) nested.add(target);
    }
  }
  const violations = new Map();
  const visitedEntities = new Set();
  function walk(data, parent, file, path, ancestors, depth) {
    if (!data || typeof data !== 'object' || ancestors.has(data) || depth > MAX_DEPTH) return;
    const candidates = matches(data, file);
    const reasons = [];
    if (data.kind === 'feature') {
      if (candidates.length > 1) reasons.push('ambiguous declaration: cannot establish unique feature nesting');
      if (!parent) reasons.push('requires an immediate capability parent; declared at root');
      else if ((parent.kind ?? 'capability') !== 'capability') {
        reasons.push(`requires an immediate capability parent; parent ${parent.id} has kind ${parent.kind}`);
      }
      if (Array.isArray(data.children) && data.children.length > 0) reasons.push('must be a leaf; children is nonempty');
    }
    for (const entity of candidates) {
      visitedEntities.add(entity);
      if (reasons.length === 0) continue;
      const entries = violations.get(entity.id) ?? new Set();
      entries.add(`${file}:${path} (${data.id}): ${reasons.join('; ')}${candidates.length > 1 ? '; ambiguous declaration matches multiple entities' : ''}`);
      violations.set(entity.id, entries);
    }
    const next = new Set(ancestors).add(data);
    if (Array.isArray(data.children)) data.children.forEach((child, index) =>
      walk(child, data, file, `${path}.children[${index}]`, next, depth + 1));
  }
  const rootCounts = new Map();
  function visitRoot(entity) {
    const file = entity.fileOrigin ?? '';
    const position = rootCounts.get(file) ?? 0;
    rootCounts.set(file, position + 1);
    walk(entity.data, null, file, `capabilities[${position}]`, new Set(), 0);
  }
  for (const entity of capabilities) if (!nested.has(entity)) visitRoot(entity);
  // A malformed cycle can have no root. Inspect its declarations once, still bounded by ancestry.
  for (const entity of capabilities) if (!visitedEntities.has(entity)) visitRoot(entity);
  const result = new Map([...violations].map(([id, entries]) => [id, [...entries].sort()]));
  cache.set(model, result);
  return result;
}

/** @param {any} model @param {any} subject */
export const capabilityKind = (model, subject) => {
  const violations = violationsByEntity(model).get(subject.id);
  return violations?.length
    ? { ok: false, context: { capability: declaredId(subject), violations: violations.join(' | ') } }
    : { ok: true };
};
