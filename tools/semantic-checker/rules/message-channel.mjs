/**
 * Whether a message channel is read, and whether the references to it agree with its declaration.
 *
 * Not expressible in the rule DSL: the subject is the channel, the evidence is the set of edges
 * pointing at it (`travels_on` from operations, `contract_subscription` from contracts) and, for a
 * queue, the `contract_receives` edges of the contracts and operations those reach. The DSL tests a
 * relation's presence or a field's presence, not a two-hop join or a comparison of an edge's data
 * against the subject's own fields.
 *
 * A reference nothing declares builds no edge, so it is silent here: it is already a
 * cross-reference error with a file and a location.
 */

const TRAVELS_ON = 'travels_on';
const CONTRACT_SUBSCRIPTION = 'contract_subscription';
const CONTRACT_RECEIVES = 'contract_receives';

/** Each binding key a channel may declare -> the exchange protocols that travel over it. */
const BINDING_PROTOCOLS = {
  amqp: new Set(['amqp', 'amqp091', 'amqp1']),
};

/** Per model: the edges this module reads, indexed once. */
const cache = new WeakMap();

function indexOf(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const byHandle = new Map();
  for (const entity of model.entities ?? []) byHandle.set(entity.id, entity);
  const travelling = new Map();
  const subscribing = new Map();
  const receivers = new Map();
  const receivesAnything = new Set();
  const add = (index, key, value) => {
    const list = index.get(key) ?? [];
    list.push(value);
    index.set(key, list);
  };
  for (const relation of model.relations ?? []) {
    if (relation.type === TRAVELS_ON) add(travelling, relation.target, relation);
    else if (relation.type === CONTRACT_SUBSCRIPTION) add(subscribing, relation.target, relation.source);
    else if (relation.type === CONTRACT_RECEIVES) {
      add(receivers, relation.target, relation.source);
      receivesAnything.add(relation.source);
    }
  }
  const index = { byHandle, travelling, subscribing, receivers, receivesAnything };
  cache.set(model, index);
  return index;
}

const labelOf = (index, handle) => {
  const entity = index.byHandle.get(handle);
  return entity?.displayId ?? handle;
};

const quoted = (labels) => [...new Set(labels)].sort().map((label) => `"${label}"`).join(', ');

const subjectContext = (subject) => ({
  subject: subject?.data?.id ?? subject?.displayId ?? subject?.id ?? '?',
  subject_name: subject?.data?.name ?? subject?.name ?? '',
});

/** A `kind: queue` channel from which no contract receives anything. */
export const messageQueueUnread = (model, subject) => {
  const index = indexOf(model);
  const subscribers = index.subscribing.get(subject?.id) ?? [];
  if (subscribers.some((contract) => index.receivesAnything.has(contract))) return { ok: true };
  // Every operation travelling on the queue counts, whichever inline object named it: naming a queue
  // as a topic is `message-channel-mismatch`'s finding, and one defect is reported once.
  const sentHere = index.travelling.get(subject?.id) ?? [];
  if (sentHere.some((edge) => (index.receivers.get(edge.source) ?? []).length > 0)) return { ok: true };
  const reason =
    subscribers.length > 0
      ? `is the subscription of ${quoted(subscribers.map((handle) => labelOf(index, handle)))}, which receive nothing, so no message is bound to it`
      : "is named by no contract's `subscription.channel_ref`, and no operation sent to it is received by a contract";
  return { ok: false, context: { ...subjectContext(subject), reason } };
};

/** A channel named as the other kind, as a subscription while a topic, or over another protocol. */
export const messageChannelMismatch = (model, subject) => {
  const index = indexOf(model);
  const kind = subject?.data?.kind;
  if (kind !== 'topic' && kind !== 'queue') return { ok: true };
  const edges = index.travelling.get(subject?.id) ?? [];
  const disagreements = [];

  const otherRole = kind === 'topic' ? 'queue' : 'topic';
  const crossed = edges.filter((edge) => edge.data?.role === otherRole).map((edge) => labelOf(index, edge.source));
  if (crossed.length > 0) disagreements.push(`${quoted(crossed)} name it through \`exchange.${otherRole}.channel_ref\``);

  if (kind === 'topic') {
    const subscribers = (index.subscribing.get(subject?.id) ?? []).map((handle) => labelOf(index, handle));
    if (subscribers.length > 0) disagreements.push(`${quoted(subscribers)} name it as their subscription queue`);
  }

  const bindingKeys = Object.keys(subject?.data?.bindings ?? {}).filter((key) => key in BINDING_PROTOCOLS);
  if (bindingKeys.length > 0) {
    const allowed = new Set(bindingKeys.flatMap((key) => [...BINDING_PROTOCOLS[key]]));
    const foreign = edges.filter((edge) => typeof edge.data?.protocol === 'string' && !allowed.has(edge.data.protocol));
    for (const protocol of [...new Set(foreign.map((edge) => edge.data.protocol))].sort()) {
      const operations = foreign.filter((edge) => edge.data.protocol === protocol).map((edge) => labelOf(index, edge.source));
      disagreements.push(`${quoted(operations)} travel on it over \`${protocol}\``);
    }
  }

  if (disagreements.length === 0) return { ok: true };
  return {
    ok: false,
    context: {
      ...subjectContext(subject),
      kind,
      bindings: bindingKeys.length > 0 ? ` with \`bindings.${bindingKeys.sort().join('`, `bindings.')}\`` : '',
      disagreements: disagreements.join('; '),
    },
  };
};
