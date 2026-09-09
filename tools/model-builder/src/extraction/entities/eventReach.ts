/**
 * Which events leave their context, derived from what the model already states.
 *
 * The blueprint schema has no subtype for an event: `kind` is `[event, command, query, document]`
 * and there is no `event_type`, no stereotype, no `visibility`, no `published`. The distinction
 * between a domain event and an integration event is nonetheless present, stated about the SERVICE
 * rather than about the event, and every consumer that wants it re-derives it from the architecture
 * layer. A second implementation of one rule is how two artifacts of one model come to disagree, so
 * the fact is derived once, here, and carried on the operation.
 *
 * It lives in the model-builder rather than in a renderer's translator because of WHOSE fact it is.
 * "This event is published across a service boundary" is true whether or not anyone draws a board,
 * and is a statement about the architecture, of the same class as "this service owns this
 * operation". A policy, by contrast, exists only because someone draws an Event Storming board, and
 * belongs to that projection. A fact belongs where its subject lives, so the next person looks in
 * the right place.
 *
 * THREE VALUES, NEVER A BOOLEAN
 *
 * Measured across the corpus before this was written: one model declares 160 events and ZERO files
 * declaring `asyncapi` contracts. A boolean would label all 160 "internal" on the strength of
 * nothing, and would do it in exactly the models whose architecture layer is least complete, where a
 * reader is least able to tell. So `unstated` is a value of its own, and it means "this scope wires
 * no contract to any event, so the model does not say" - not "no".
 *
 * The evidence travels with the value. A classification that cannot say what it rests on becomes a
 * belief.
 */
import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain } from '../relations/resolver.js';

/**
 * How far an event reaches, on the blueprint's own terms.
 *
 * An enumerated constant rather than string literals at call sites, in the idiom `ENTITY_TYPE` and
 * `RELATION_TYPE` already use here: the values are read by a translator in another package, and a
 * value spelled twice is a value that can drift once.
 */
export const EVENT_REACH = {
  /** A contract, a messaging transport or a cross-scope reaction says it leaves its context. */
  Published: 'published',
  /** This scope wires contracts to events, and none of them wires this one. */
  Internal: 'internal',
  /** Nothing in this scope wires a contract to an event, so the model does not say. */
  Unstated: 'unstated',
} as const;

export type EventReach = (typeof EVENT_REACH)[keyof typeof EVENT_REACH];

/** What produced a `published` verdict, strongest first. */
export const EVENT_REACH_EVIDENCE = {
  /** A service contract names it in `send` or `receive`: a declared audience. */
  Contract: 'contract',
  /** Its `exchange` names a messaging protocol and a channel: it travels off-process. */
  Exchange: 'exchange',
  /** An operation in another scope declares `reacts_to` it. */
  CrossScopeReaction: 'cross-scope-reaction',
  /** No signal fired, and this scope does wire contracts to events. */
  NoSignal: 'no-signal',
  /** This scope wires no contract to any event. */
  NoContractCoverage: 'no-contract-coverage',
} as const;

export type EventReachEvidence = (typeof EVENT_REACH_EVIDENCE)[keyof typeof EVENT_REACH_EVIDENCE];

/**
 * The protocols the schema treats as messaging, which is what makes a channel meaningful.
 *
 * Mirrors the `exchange` conditional in `design/domain.schema.yaml`: these are the protocols for
 * which the schema REQUIRES a `topic` or a `queue`. Kept in step by `eventReach.schema.test.ts`,
 * which reads that enum out of the schema file - a list typed here and never re-checked is the
 * shape that goes stale the day a protocol is added, silently and in the safe direction.
 */
export const MESSAGING_PROTOCOLS: ReadonlySet<string> = new Set([
  'amqp',
  'amqp091',
  'amqp1',
  'mqtt',
  'kafka',
]);

/** The field the classification is written to, and the one beside it that says why. */
export const EVENT_REACH_FIELD = '_event_reach';
export const EVENT_REACH_EVIDENCE_FIELD = '_event_reach_evidence';

const dataOf = (entity: Entity): Record<string, unknown> => (entity.data ?? {}) as Record<string, unknown>;

const isEvent = (entity: Entity): boolean =>
  entity.type === ENTITY_TYPE.Operation && dataOf(entity).kind === 'event';

/**
 * Does this operation's `exchange` say it travels off-process?
 *
 * `exchange` is a single object or an array of them (the schema declares both), and a messaging
 * protocol only means something with a channel to carry it - the schema requires `topic` or `queue`
 * for exactly these protocols, so an exchange naming `kafka` and no channel is an incomplete
 * statement rather than a quiet yes.
 */
function travelsOffProcess(entity: Entity): boolean {
  const declared = dataOf(entity).exchange;
  const exchanges = Array.isArray(declared) ? declared : declared == null ? [] : [declared];
  return exchanges.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const exchange = entry as Record<string, unknown>;
    if (typeof exchange.protocol !== 'string' || !MESSAGING_PROTOCOLS.has(exchange.protocol)) return false;
    return exchange.topic != null || exchange.queue != null;
  });
}

/**
 * Classify every event in the model and write the verdict onto its entity.
 *
 * Runs AFTER relations are built and after ids are final: two of the three signals are relations,
 * and reading them is not parsing the architecture layer a second time - `contract_sends` and
 * `contract_receives` are first-class relation types the extractor already produced.
 *
 * Mutates entity `data` in place, the way `annotateOwnershipDefaults` does, so a consumer that
 * ignores the field is unaffected and nothing downstream has to thread a second structure through.
 */
export function annotateEventReach(entities: Entity[], relations: Relation[]): void {
  const events = entities.filter(isEvent);
  if (events.length === 0) return;

  const eventIds = new Set(events.map((entity) => entity.id));
  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  /** Events a contract names in `send` or `receive`, and the scopes whose contracts name any. */
  const wiredByContract = new Set<string>();
  const scopesWiringContracts = new Set<string>();
  /** Events some operation in ANOTHER scope declares it reacts to. */
  const reachedAcrossScope = new Set<string>();

  for (const relation of relations) {
    if (relation.type === RELATION_TYPE.ContractSends || relation.type === RELATION_TYPE.ContractReceives) {
      // The scope is the CONTRACT's, not the event's: the question this answers is "does this part
      // of the model wire contracts to events at all", and a contract in `orders` wiring an event
      // declared in `billing` is still `orders` saying something. A scope whose contracts wire
      // nothing is the scope that cannot tell internal from unstated.
      const contract = byId.get(relation.source_entity_id);
      if (contract) scopesWiringContracts.add(entityDomain(contract));
      if (eventIds.has(relation.target_entity_id)) wiredByContract.add(relation.target_entity_id);
      continue;
    }
    if (relation.type !== RELATION_TYPE.ReactsTo) continue;
    // `reacts_to` points from the reacting operation to the event that triggers it.
    if (!eventIds.has(relation.target_entity_id)) continue;
    const reactor = byId.get(relation.source_entity_id);
    const event = byId.get(relation.target_entity_id);
    if (!reactor || !event) continue;
    if (entityDomain(reactor) !== entityDomain(event)) reachedAcrossScope.add(event.id);
  }

  for (const event of events) {
    const [reach, evidence] = classify(event, wiredByContract, reachedAcrossScope, scopesWiringContracts);
    const data = (event.data ?? {}) as Record<string, unknown>;
    data[EVENT_REACH_FIELD] = reach;
    data[EVENT_REACH_EVIDENCE_FIELD] = evidence;
    event.data = data;
  }
}

/**
 * The three signals in strength order, then the two ways of saying no.
 *
 * Order matters and is the step's own table: a declared contract is closest to intent, a transport
 * says how it travels rather than to whom, and a cross-scope reaction is evidence of crossing with
 * no architecture layer involved at all. The first to fire owns the evidence, so a reader sees the
 * strongest reason rather than the last one checked.
 */
function classify(
  event: Entity,
  wiredByContract: ReadonlySet<string>,
  reachedAcrossScope: ReadonlySet<string>,
  scopesWiringContracts: ReadonlySet<string>,
): [EventReach, EventReachEvidence] {
  if (wiredByContract.has(event.id)) return [EVENT_REACH.Published, EVENT_REACH_EVIDENCE.Contract];
  if (travelsOffProcess(event)) return [EVENT_REACH.Published, EVENT_REACH_EVIDENCE.Exchange];
  if (reachedAcrossScope.has(event.id)) {
    return [EVENT_REACH.Published, EVENT_REACH_EVIDENCE.CrossScopeReaction];
  }
  // The distinction the third value exists for. "No contract names it" means `internal` only where
  // contracts name events at all; where none does, the model has not been asked the question.
  return scopesWiringContracts.has(entityDomain(event))
    ? [EVENT_REACH.Internal, EVENT_REACH_EVIDENCE.NoSignal]
    : [EVENT_REACH.Unstated, EVENT_REACH_EVIDENCE.NoContractCoverage];
}

/** Read the classification back off an entity - `undefined` when the pass has not run. */
export function eventReachOf(entity: Entity): EventReach | undefined {
  const value = dataOf(entity)[EVENT_REACH_FIELD];
  return typeof value === 'string' ? (value as EventReach) : undefined;
}

/** Read the evidence back off an entity - `undefined` when the pass has not run. */
export function eventReachEvidenceOf(entity: Entity): EventReachEvidence | undefined {
  const value = dataOf(entity)[EVENT_REACH_EVIDENCE_FIELD];
  return typeof value === 'string' ? (value as EventReachEvidence) : undefined;
}
