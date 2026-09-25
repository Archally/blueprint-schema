/**
 * A relation whose source or target id matches no entity in the model at all.
 *
 * Every ref a model AUTHORS resolves one of two ways: to a real entity, or - where the ref names
 * nothing - to a `Missing` placeholder entity the builder creates for exactly that case (see
 * `resolver.ts`: "a ref naming nothing produces no edge and no placeholder" is the ONE
 * documented exception, and it is a schema cross-reference ERROR, not silence). Either way the
 * relation's endpoint is an id some entity actually has.
 *
 * A DERIVED relation - one a builder computes from edges the model already materialized, rather
 * than from an authored ref - can skip that path entirely. Nothing stops it from constructing an
 * endpoint id by hand, and if that construction is wrong the result is a relation whose source or
 * target is not `Missing`, is not a real entity, is not anything: a string that happens to sit in
 * `source_entity_id` or `target_entity_id`. `bp validate` never sees it, because validation checks
 * AUTHORED refs; the model still builds; a reader sees an arrow on a diagram that points at
 * nothing and has no way to tell.
 *
 * FOUND THIS WAY TWICE ALREADY, in two files that built the identical shape of key. Both
 * `contractTraffic.ts` (consumer/provider pair) and `coverage.ts` (context/domain pair) built
 * their join key as one string (`${idA} ${idB}`) and split it back apart with `split(' ')`. A
 * context id is derived from its NAME (`makeInternalId`), which is author-controlled free text -
 * "Order Fulfillment", not "OrderFulfillment" - so an id carrying its own embedded space split in
 * the wrong place and BOTH derived endpoints ended up pointing at ids no entity has, silently, on
 * every affected model. Both are fixed now, by keying the join with a nested Map instead of a
 * delimited string - which is exactly the regression this rule exists to keep a reader from
 * having to find a third time, by hand.
 *
 * WHY `find: { all: true }` RATHER THAN `relation_type`. The engine's `check.custom` extension
 * receives the model and the subject's resolved SOURCE entity only (`getSubjectEntity`) - never the
 * relation itself, so a `relation_type` find has no way to read a relation's own id, type or
 * target from inside the custom function. Walking every entity and computing the answer once,
 * cached per model, sidesteps that: `index()` scans `model.relations` directly, which is always
 * available as the first argument regardless of what the engine resolved for the second one. The
 * finding is then attributed to ONE deterministic entity (the smallest id in the model, so the
 * choice does not depend on find/iteration order) rather than to every entity the engine happens
 * to walk, which would repeat the same list of broken relations once per entity in the model.
 */

/** One index per model, however many entities the engine walks. */
const cache = new WeakMap();

function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  const entityIds = new Set((model.entities ?? []).map((entity) => entity.id));
  const broken = [];
  for (const relation of model.relations ?? []) {
    const sourceMissing = !entityIds.has(relation.source);
    const targetMissing = !entityIds.has(relation.target);
    if (sourceMissing || targetMissing) broken.push({ relation, sourceMissing, targetMissing });
  }

  // The reporter is whichever entity sorts first by id - arbitrary, but fixed, so the finding
  // fires exactly once per model regardless of which order `find: { all: true }` happens to walk.
  let reporterId = null;
  for (const entity of model.entities ?? []) {
    if (reporterId === null || entity.id < reporterId) reporterId = entity.id;
  }

  const built = { broken, reporterId };
  cache.set(model, built);
  return built;
}

/** One line per broken relation, naming which side (or both) failed to resolve. */
function describeBroken({ relation, sourceMissing, targetMissing }) {
  const side = sourceMissing && targetMissing ? 'both endpoints' : sourceMissing ? 'source' : 'target';
  const unresolved = [sourceMissing ? relation.source : null, targetMissing ? relation.target : null]
    .filter((value) => value !== null)
    .join(' / ');
  return `${relation.type} "${relation.id}" (${side} unresolved: ${unresolved})`;
}

export const danglingRelationEndpoint = (model, subjectEntity) => {
  const { broken, reporterId } = index(model);
  if (broken.length === 0) return { ok: true };
  if (!subjectEntity || subjectEntity.id !== reporterId) return { ok: true };

  const lines = broken.map(describeBroken).sort();
  return {
    ok: false,
    context: {
      count: String(broken.length),
      relations: lines.join('; '),
    },
  };
};
