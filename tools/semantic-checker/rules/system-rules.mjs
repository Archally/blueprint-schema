/**
 * Two checks the rule DSL cannot express, because each reads a fact off an entity OTHER than the
 * subject: the kind of the party a service's `system_ref` edge reaches, and the conflict list the
 * party fold writes onto the surviving party node.
 *
 * Both read materialized facts and derive nothing of their own. The `system_ref` edge is the
 * model-builder's single reading of the three ways an author places a service in a system
 * (nested under a party, `system_ref` on the service, the document's `system_ref` default), and
 * `_conflicts` is what `mergeParties` could not reconcile. A rule that recomputed either would be
 * a second implementation of the same reading, and the two would drift.
 */

const SYSTEM_REF = 'system_ref';
const ORGANIZATION = 'organization';

/** One index per model, however many subjects the engine walks. */
const cache = new WeakMap();

function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const entityById = new Map();
  for (const entity of model.entities ?? []) entityById.set(entity.id, entity);
  const systemOf = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== SYSTEM_REF) continue;
    if (!systemOf.has(relation.source)) systemOf.set(relation.source, relation.target);
  }
  const result = { entityById, systemOf };
  cache.set(model, result);
  return result;
}

const labelOf = (entity) => entity?.data?.id ?? entity?.displayId ?? entity?.id ?? '?';

/**
 * The subject's system is a party of kind `organization`.
 *
 * Silent when the service has no system (its own rule says so), when the system is a placeholder
 * (the reference walk reports the dangling id), and when the party declares no kind: the schema
 * never required one, so its absence is not a finding.
 */
export const serviceSystemIsAnOrganization = (model, subject) => {
  if (!subject) return { ok: true };
  const { entityById, systemOf } = index(model);
  const targetId = systemOf.get(subject.id);
  if (!targetId) return { ok: true };
  const system = entityById.get(targetId);
  if (!system || system.data?.kind !== ORGANIZATION) return { ok: true };
  return { ok: false, context: { system: labelOf(system) } };
};

/**
 * The subject's declarations disagree on at least one member.
 *
 * Reads `_conflicts`, which the party fold writes on the surviving node beside `_sources`. A party
 * without the key has parts that agree, or one part only.
 */
export const partyPartsDisagree = (model, subject) => {
  const conflicts = subject?.data?._conflicts;
  if (!Array.isArray(conflicts) || conflicts.length === 0) return { ok: true };
  const keys = [...new Set(conflicts.map((conflict) => conflict.key))];
  const files = [...new Set(conflicts.flatMap((conflict) => conflict.sources ?? []))];
  return {
    ok: false,
    context: {
      party: labelOf(subject),
      party_name: subject?.data?.name ?? subject?.displayId ?? '',
      keys: keys.join(', '),
      files: files.join(', '),
    },
  };
};
