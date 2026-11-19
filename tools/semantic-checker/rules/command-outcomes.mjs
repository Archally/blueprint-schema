/**
 * A command states an outcome, while governance and event consumption supply separate advice.
 * The DSL cannot inspect nonempty nested reference arrays or quantify all incoming producers.
 * Index the checkable graph once; publication is the builder's derived fact, never re-derived here.
 */
const indexes = new WeakMap();

function graphOf(model) {
  const cached = indexes.get(model);
  if (cached) return cached;
  const entities = new Map((model.entities ?? []).map((entity) => [entity.id, entity]));
  const produced = new Map();
  const producers = new Map();
  const reacted = new Set();
  const translated = new Set();
  for (const relation of model.relations ?? []) {
    if (relation.type === 'produces') {
      const targets = produced.get(relation.source) ?? [];
      targets.push(entities.get(relation.target));
      produced.set(relation.source, targets);
      const sources = producers.get(relation.target) ?? [];
      sources.push(entities.get(relation.source));
      producers.set(relation.target, sources);
    }
    if (relation.type === 'reacts_to' && entities.get(relation.source)?.type === 'Operation') reacted.add(relation.target);
    if (relation.type === 'translates') {
      translated.add(relation.source);
      translated.add(relation.target);
    }
  }
  const index = { produced, producers, reacted, translated };
  indexes.set(model, index);
  return index;
}

const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;
const hasEntry = (value, predicate) => Array.isArray(value) && value.some(predicate);
const kindOf = (entity) => entity?.type === 'Operation' ? entity.data?.kind : undefined;
const legacyMetadata = new Set(['businessDomain', 'id', 'name', 'description', 'summary', 'tags', 'version', 'metadata', 'note', 'notes', 'provenance', 'code_refs']);
const clausePresent = (value) => nonblank(value) || hasEntry(value, nonblank);

function governed(entity) {
  const data = entity?.data ?? {};
  for (const field of ['governed_by', 'preconditions', 'postconditions']) {
    if (hasEntry(data[field], (reference) => nonblank(reference?.rule))) return true;
  }
  const legacy = data.rules;
  if (legacy === null || typeof legacy !== 'object' || Array.isArray(legacy)) return false;
  return Object.entries(legacy).some(([field, value]) => !legacyMetadata.has(field) && clausePresent(value));
}

/** Any declared produces reference, including a document or unresolved ref, is an outcome. */
export function commandHasOutcome(model, subject) {
  if (kindOf(subject) !== 'command') return { ok: true };
  const data = subject.data ?? {};
  const produced = graphOf(model).produced.get(subject.id) ?? [];
  const stated = produced.length > 0
    || hasEntry(data.produces?.operations, nonblank)
    || hasEntry(data.materializes, (entry) => nonblank(entry?.concept) && nonblank(entry?.action))
    || hasEntry(data.side_effects?.writes, (entry) => nonblank(entry?.target));
  return { ok: stated };
}

/** Governance without a produced event is advice, even when another outcome is already stated. */
export function governedCommandHasEvent(model, subject) {
  if (kindOf(subject) !== 'command' || !governed(subject)) return { ok: true };
  const targets = graphOf(model).produced.get(subject.id) ?? [];
  return { ok: targets.some((target) => kindOf(target) === 'event') };
}

/** A nonempty set of exclusively ungoverned command producers, with no contrary evidence. */
export function eventHasCausalEvidence(model, subject) {
  if (kindOf(subject) !== 'event') return { ok: true };
  const graph = graphOf(model);
  const producers = graph.producers.get(subject.id) ?? [];
  if (producers.length === 0) return { ok: true };
  if (producers.some((producer) => kindOf(producer) !== 'command' || governed(producer))) return { ok: true };
  if (graph.reacted.has(subject.id) || graph.translated.has(subject.id)) return { ok: true };
  if (subject.data?._event_reach === 'published') return { ok: true };
  return { ok: false, context: { reach: subject.data?._event_reach ?? 'unstated' } };
}
