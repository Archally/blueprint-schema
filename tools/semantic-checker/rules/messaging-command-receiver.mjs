/** A sent command needs exactly one receiving service to replace its legacy sender binding. */
const cache = new WeakMap();

function index(model) {
  const cached = cache.get(model);
  if (cached) {
    return cached;
  }
  const entities = new Map((model.entities ?? []).map(entity => [entity.id, entity]));
  const serviceByContract = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== 'provides') {
      continue;
    }
    if (entities.get(relation.source)?.type !== 'Service') {
      continue;
    }
    serviceByContract.set(relation.target, relation.source);
  }
  const sent = new Set();
  const receivers = new Map();
  for (const relation of model.relations ?? []) {
    const service = serviceByContract.get(relation.source);
    if (!service) {
      continue;
    }
    if (relation.type === 'contract_sends') {
      sent.add(relation.target);
    }
    if (relation.type === 'contract_receives') {
      const receiving = receivers.get(relation.target) ?? new Set();
      receiving.add(service);
      receivers.set(relation.target, receiving);
    }
  }
  const state = { entities, sent, receivers };
  cache.set(model, state);
  return state;
}

export function messagingCommandReceiver(model, subject) {
  if (subject.data?.kind !== 'command') {
    return { ok: true };
  }
  const state = index(model);
  if (!state.sent.has(subject.id)) {
    return { ok: true };
  }
  const receivers = [...(state.receivers.get(subject.id) ?? [])];
  if (receivers.length === 1) {
    return { ok: true };
  }
  const services = receivers.map(id => state.entities.get(id)).map(service => {
    const id = service?.data?.id ?? service?.displayId ?? service?.id;
    const name = service?.data?.name ?? service?.name ?? id;
    return `${id} "${name}"`;
  }).sort();
  return {
    ok: false,
    context: {
      count: String(receivers.length),
      services: services.join(', ') || 'none',
      operation_name: subject.data?.name ?? subject.name ?? subject.displayId,
    },
  };
}
