/**
 * Whether the resource a messaging contract names as its broker says it is one.
 *
 * Not expressible in the rule DSL: the subject is the resource, the evidence is the set of
 * contracts whose `contract_broker` edge points at it, and the verdict reads the subject's own
 * `kind`. The DSL tests a relation's presence or a field's presence, not both against each other.
 *
 * Silent for a resource no contract names, whatever its kind, and for an unresolved `broker_ref`,
 * which builds no edge and is already a cross-reference error with a file and a location.
 */

const CONTRACT_BROKER = 'contract_broker';
const BROKER_KIND = 'broker';

/** Resource handle -> the contracts naming it as their broker, computed once per model. */
const cache = new WeakMap();

function contractsByBroker(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const byHandle = new Map();
  for (const entity of model.entities ?? []) byHandle.set(entity.id, entity);
  const index = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== CONTRACT_BROKER) continue;
    const contract = byHandle.get(relation.source);
    const label = contract?.displayId ?? relation.source;
    const list = index.get(relation.target) ?? [];
    if (!list.includes(label)) list.push(label);
    index.set(relation.target, list);
  }
  cache.set(model, index);
  return index;
}

/** A resource named by a contract's `broker_ref` whose `kind` is not `broker`. */
export const brokerRefTargetNotABroker = (model, subject) => {
  const contracts = contractsByBroker(model).get(subject?.id);
  if (!contracts || contracts.length === 0) return { ok: true };
  const kind = subject?.data?.kind;
  if (kind === BROKER_KIND) return { ok: true };
  return {
    ok: false,
    context: {
      subject: subject?.data?.id ?? subject?.displayId ?? subject?.id ?? '?',
      subject_name: subject?.data?.name ?? subject?.name ?? '',
      contracts: [...contracts].sort().map((label) => `"${label}"`).join(', '),
      kind: typeof kind === 'string' && kind.length > 0 ? kind : '(none)',
    },
  };
};
