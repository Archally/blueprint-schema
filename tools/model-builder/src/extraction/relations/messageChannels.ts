import type { Entity, Relation } from '../../model/types.js';
import { indexDeclarations, resolveReference, type RefDeclaration, type RefIndex } from './refResolution.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Extract the message-channel relations (v2.8.67) from the entity list.
 *
 *   MessageChannel --channel_broker-->        InfraResource  (channel.broker_ref)
 *   Operation      --travels_on-->            MessageChannel (exchange.topic.channel_ref /
 *                                                             exchange.queue.channel_ref)
 *   Contract       --contract_subscription--> MessageChannel (subscription.channel_ref)
 *
 * `travels_on` carries `data.role` (`topic` or `queue`, the inline object that named the channel),
 * `data.name` (that object's inline `name`: the routing key on a topic channel) and `data.protocol`
 * (the exchange entry's protocol), so a reader of the edge has what the operation said about this
 * channel without re-reading the operation and re-resolving its references. An operation's `exchange`
 * is an object or an array of them; every entry naming a channel builds an edge, and entries naming
 * one channel twice are one edge, the first one read, because a relation id is built from the pair.
 *
 * Every field read here is a typed reference, so a miss builds no edge and no placeholder: it is
 * already a cross-reference error with a file and a location (the rule `infrastructure.ts` states).
 * A consumer group named by `subscription.name` is not an entity and builds nothing.
 */

/** Entities of one type, indexed by the id string each was declared with. */
class EntitiesById {
  private readonly declarations: RefDeclaration[] = [];
  private readonly byHandle = new Map<string, Entity>();
  private index: RefIndex | null = null;

  add(entity: Entity): void {
    this.declarations.push({ id: entity.displayId, handle: entity.id });
    this.byHandle.set(entity.id, entity);
    this.index = null;
  }

  /** The one entity declared with exactly this string; none when no entity or several do. */
  resolve(ref: unknown): Entity | undefined {
    if (typeof ref !== 'string' || ref.length === 0) return undefined;
    this.index ??= indexDeclarations(this.declarations);
    const resolution = resolveReference(this.index, ref);
    return resolution.status === 'resolved' ? this.byHandle.get(resolution.handle) : undefined;
  }
}

const CHANNEL_ROLES = ['topic', 'queue'] as const;

export function extractMessageChannelRelations(entities: Entity[]): Relation[] {
  const channels = new EntitiesById();
  const resources = new EntitiesById();
  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.MessageChannel) channels.add(entity);
    else if (entity.type === ENTITY_TYPE.InfraResource) resources.add(entity);
  }

  const relations: Relation[] = [];
  const emitted = new Set<string>();
  const push = (source: Entity, type: string, target: Entity, data?: Record<string, unknown>): void => {
    const id = `${source.id}--${type}--${target.id}`;
    if (emitted.has(id)) return;
    emitted.add(id);
    relations.push({
      id,
      source_entity_id: source.id,
      target_entity_id: target.id,
      type,
      ...(data ? { data } : {}),
    });
  };

  for (const entity of entities) {
    const data = (entity.data as Record<string, unknown> | undefined) ?? {};

    if (entity.type === ENTITY_TYPE.MessageChannel) {
      const broker = resources.resolve(data.broker_ref);
      if (broker) push(entity, RELATION_TYPE.ChannelBroker, broker);
      continue;
    }

    if (entity.type === ENTITY_TYPE.Operation) {
      const exchanges = Array.isArray(data.exchange) ? data.exchange : [data.exchange];
      for (const exchange of exchanges) {
        if (!exchange || typeof exchange !== 'object') continue;
        for (const role of CHANNEL_ROLES) {
          const binding = (exchange as Record<string, unknown>)[role];
          if (!binding || typeof binding !== 'object') continue;
          const channel = channels.resolve((binding as Record<string, unknown>).channel_ref);
          if (!channel) continue;
          const name = (binding as Record<string, unknown>).name;
          const protocol = (exchange as Record<string, unknown>).protocol;
          push(entity, RELATION_TYPE.TravelsOn, channel, {
            role,
            ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
            ...(typeof protocol === 'string' && protocol.length > 0 ? { protocol } : {}),
          });
        }
      }
      continue;
    }

    if (entity.type === ENTITY_TYPE.Contract) {
      const subscription = data.subscription as Record<string, unknown> | undefined;
      const channel = channels.resolve(subscription?.channel_ref);
      if (channel) push(entity, RELATION_TYPE.ContractSubscription, channel);
    }
  }

  return relations;
}
