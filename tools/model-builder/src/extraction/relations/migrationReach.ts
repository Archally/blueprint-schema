import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { resolveRefDetailed } from './resolver.js';

/**
 * Which bounded contexts and domains a migration changes, and how each was established.
 *
 * A migration names its changes, not the contexts they fall in. The reach is DERIVED from each typed
 * change target: the target resolves to an entity of a model state, the entity to its one bounded
 * context through the membership edges the graph already holds, and the context to its domain
 * through `context_realizes_domain`. A bounded context or domain named as a target counts directly.
 * A migration may also STATE its reach in `reach`, for changes the derivation cannot read: prose, or a
 * planned migration whose changes are not written yet. The two are kept apart, so a reader always
 * sees which contexts the changes show and which only the author says.
 *
 * NOTHING IS GUESSED. A change naming no target (prose, a tag selection, a reference rewrite), a
 * target that does not resolve to exactly one entity, an entity with no bounded context, and one
 * with several are each recorded as NOT DERIVED, with the change, the state it was read against and
 * the outcome. An unknown is never an empty reach: `not_derived` counts what could not be traced,
 * and a migration whose every change is untraced has an unknown reach, not a reach of nothing.
 *
 * Membership, by entity type, using only edges the builder derives elsewhere:
 *   Context       itself
 *   Domain        counts as a domain directly
 *   Subdomain     the domain it is declared in
 *   Service       the context whose `contains` edge holds it
 *   Operation     the contexts of its `handled_by` edges
 *   Question      the context of its `scoped_to` edge
 *   Concept       the contexts of the `context_uses_concept` edges that reach it
 * Any other type has no bounded context of its own and is recorded as `no-context`.
 *
 * STATES. The builder holds one model state. A change that adds an entity is read against the state
 * after the migration; every other change against the state before it. When the state at hand is
 * the other one, the target is still looked up there (a modified or deprecated entity usually
 * survives), and the trace records the state it was actually read against. An added entity that the
 * state at hand does not hold is read from the change's typed added data instead: an added bounded
 * context or domain counts directly, and an entity placed `under` a bounded context reaches it. A
 * later change of the same migration naming that added entity is read the same way.
 */

/** Which of the three migration shapes a record comes from. */
export type MigrationShape = 'document' | 'register' | 'tracked';

/** The model state a target was read against. `added-data` is the change's own typed data. */
export type ReachState = 'before' | 'after' | 'added-data';

/** What reading one change established. */
export type ReachOutcome =
  | 'context'
  | 'domain'
  | 'no-context'
  | 'ambiguous-context'
  | 'unresolved'
  | 'untyped';

/** One change of a migration, in the form the derivation reads. */
export interface ReachChange {
  /** Where the change sits in its migration, e.g. `changes.entities[0]` or `change_set[2]`. */
  source: string;
  /** The change's own kind or operation, as written. */
  kind: string;
  /** The typed id the change names, or null when it names none. */
  target: string | null;
  /** True when the change brings the target into existence. */
  adds: boolean;
  /** For an added entity: the entity type the change states. */
  addedType?: string;
  /** For an added entity: the container the change places it under, by id. */
  addedUnder?: string;
}

/** The result of reading one change. Ids are display ids. */
export interface ReachTrace {
  source: string;
  kind: string;
  target: string | null;
  state: ReachState | null;
  outcome: ReachOutcome;
  contexts: string[];
  domains: string[];
}

export type ReachProvenance = 'derived' | 'declared' | 'both';

/** One bounded context or domain in a migration's reach. */
export interface ReachItem {
  /** The display id, as declared. */
  id: string;
  /** The graph entity, when the id resolves to exactly one. */
  entity?: string;
  provenance: ReachProvenance;
  /** The changes that derived it, by `source`. Empty for a declared-only item. */
  sources: string[];
}

export interface MigrationReach {
  contexts: ReachItem[];
  domains: ReachItem[];
  /** One per change, in the order the migration lists them. */
  traces: ReachTrace[];
  /** How many changes did not establish a context or domain. */
  not_derived: number;
  /**
   * How far the changes establish the reach: `complete` when every change was traced, `partial` when
   * some were, `unknown` when none were or the migration lists no change. An unknown derivation is
   * never a reach of nothing.
   */
  derivation: 'complete' | 'partial' | 'unknown';
  /** Whether the migration states a `reach` of its own. */
  declared: boolean;
}

/** A model state: its entities and the relations built over them. */
export interface ReachView {
  entities: Entity[];
  relations: Relation[];
  /** Whether this state is the model before or after the migration. */
  state: 'before' | 'after';
}

type FieldMap = Record<string, unknown>;

function asRecord(value: unknown): FieldMap | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as FieldMap) : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The changes of one migration record, in the form the derivation reads.
 *
 * `document` is the migration document's root (the record is its `migration:` block and the changes
 * sit beside it); `register` is one register entry; `tracked` is one tracked entry.
 */
export function migrationChanges(shape: MigrationShape, record: FieldMap, documentRoot?: FieldMap): ReachChange[] {
  const changes: ReachChange[] = [];
  if (shape === 'register') {
    const list = Array.isArray(record.changes) ? record.changes : [];
    list.forEach((change, index) => {
      const item = asRecord(change) ?? {};
      changes.push({
        source: `changes[${index}]`,
        kind: String(item.type ?? ''),
        target: nonEmpty(item.entity),
        adds: item.type === 'add',
      });
    });
    return changes;
  }

  if (shape === 'tracked') {
    const list = Array.isArray(record.change_set) ? record.change_set : [];
    list.forEach((change, index) => {
      const item = asRecord(change) ?? {};
      const op = String(item.op ?? '');
      const source = `change_set[${index}]`;
      if (op === 'new') {
        const data = asRecord(item.data) ?? {};
        changes.push({
          source, kind: op, target: nonEmpty(data.id), adds: true,
          addedType: nonEmpty(item.entity_type) ?? undefined,
          addedUnder: nonEmpty(item.under) ?? undefined,
        });
        return;
      }
      if (op === 'rename') {
        changes.push({ source, kind: op, target: nonEmpty(item.from), adds: false });
        return;
      }
      if (op === 'patch' || op === 'delete' || op === 'move') {
        changes.push({ source, kind: op, target: nonEmpty(item.target), adds: false });
        return;
      }
      // `tag` selects by a filter and `rewrite-ref` moves references held by entities it does not
      // name: neither states the entities it changes.
      changes.push({ source, kind: op, target: null, adds: false });
    });
    return changes;
  }

  const root = documentRoot ?? {};
  const block = asRecord(root.changes) ?? {};
  const read = (key: string, targetKey: string): void => {
    const list = Array.isArray(block[key]) ? (block[key] as unknown[]) : [];
    list.forEach((change, index) => {
      const item = asRecord(change) ?? {};
      const kind = String(item.kind ?? '');
      const source = `changes.${key}[${index}]`;
      const raw = nonEmpty(item[targetKey]);
      // A merge names its sources in one comma-separated target.
      const targets = key === 'entities' && kind === 'merge' && raw ? raw.split(',').map(part => part.trim()).filter(Boolean) : [raw];
      for (const target of targets) {
        changes.push({
          source, kind, target, adds: key === 'entities' && kind === 'add',
          addedType: key === 'entities' ? nonEmpty(item.entity_type) ?? undefined : undefined,
        });
      }
    });
  };
  read('entities', 'target');
  read('properties', 'target');
  read('relationships', 'subject');
  const meta = Array.isArray(block.meta) ? block.meta : [];
  meta.forEach((change, index) => {
    const item = asRecord(change) ?? {};
    changes.push({ source: `changes.meta[${index}]`, kind: String(item.kind ?? ''), target: null, adds: false });
  });
  return changes;
}

/** The membership a view's relations state, indexed once per view. */
interface Membership {
  byId: Map<string, Entity>;
  contextsOf: Map<string, Set<string>>;
  domainOf: Map<string, Set<string>>;
}

const memberships = new WeakMap<Relation[], Membership>();

function membershipOf(view: ReachView): Membership {
  const cached = memberships.get(view.relations);
  if (cached) return cached;
  const byId = new Map(view.entities.map(entity => [entity.id, entity]));
  const contextsOf = new Map<string, Set<string>>();
  const domainOf = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };
  const isContext = (id: string): boolean => byId.get(id)?.type === ENTITY_TYPE.Context;
  for (const relation of view.relations) {
    const { source_entity_id: from, target_entity_id: to, type } = relation;
    if (type === RELATION_TYPE.HandledBy && isContext(to)) add(contextsOf, from, to);
    if (type === RELATION_TYPE.ScopedTo && isContext(to)) add(contextsOf, from, to);
    if (type === RELATION_TYPE.ContextUsesConcept && isContext(from)) add(contextsOf, to, from);
    if (type === RELATION_TYPE.Contains && isContext(from) && byId.get(to)?.type === ENTITY_TYPE.Service) add(contextsOf, to, from);
    if (type === RELATION_TYPE.ContextRealizesDomain && isContext(from) && byId.get(to)?.type === ENTITY_TYPE.Domain) add(domainOf, from, to);
  }
  const membership = { byId, contextsOf, domainOf };
  memberships.set(view.relations, membership);
  return membership;
}

/** The one domain a context realizes, or null when it states none or several. */
function domainOfContext(membership: Membership, contextId: string): string | null {
  const domains = membership.domainOf.get(contextId);
  if (!domains || domains.size !== 1) return null;
  return [...domains][0]!;
}

/** The id an entity is declared and referenced by: a context's display id is its name. */
function displayOf(membership: Membership, id: string): string {
  const entity = membership.byId.get(id);
  if (!entity) return id;
  const declared = asRecord(entity.data)?.id;
  return typeof declared === 'string' && declared !== '' ? declared : entity.displayId;
}

/** Resolve one typed id in a view to exactly one entity, or null. */
function resolveOne(view: ReachView, ref: string): Entity | null {
  const resolution = resolveRefDetailed(ref, view.entities);
  if (resolution.status !== 'resolved') return null;
  return membershipOf(view).byId.get(resolution.handle) ?? null;
}

const CONTEXT_ID = /^([a-z][a-z0-9-]*\.)?BC\d{3,}$/;
const DOMAIN_ID = /^DMN\d{3,}$/;

/** What one entity reaches: its contexts and the domains it counts as or falls in. */
function reachOfEntity(view: ReachView, entity: Entity): { outcome: ReachOutcome; contexts: string[]; domains: string[] } {
  const membership = membershipOf(view);
  if (entity.type === ENTITY_TYPE.Domain) return { outcome: 'domain', contexts: [], domains: [entity.id] };
  if (entity.type === ENTITY_TYPE.Subdomain) {
    const parent = nonEmpty(asRecord(entity.data)?._domain);
    const domain = parent ? resolveOne(view, parent) : null;
    if (domain && domain.type === ENTITY_TYPE.Domain) return { outcome: 'domain', contexts: [], domains: [domain.id] };
    return { outcome: 'no-context', contexts: [], domains: [] };
  }
  const contexts = entity.type === ENTITY_TYPE.Context ? new Set([entity.id]) : membership.contextsOf.get(entity.id) ?? new Set<string>();
  if (contexts.size === 0) return { outcome: 'no-context', contexts: [], domains: [] };
  if (contexts.size > 1) return { outcome: 'ambiguous-context', contexts: [], domains: [] };
  const context = [...contexts][0]!;
  const domain = domainOfContext(membership, context);
  return { outcome: 'context', contexts: [context], domains: domain ? [domain] : [] };
}

/**
 * Read one change against a view. Context and domain ids in the result are graph entity ids, except
 * an added context or domain the view does not hold, which keeps the id its change states.
 */
function readChange(view: ReachView, change: ReachChange, addedByThisMigration: Map<string, ReachTrace>): ReachTrace {
  const base = { source: change.source, kind: change.kind, target: change.target };
  if (!change.target) return { ...base, state: null, outcome: 'untyped', contexts: [], domains: [] };
  const entity = resolveOne(view, change.target);
  if (entity) {
    const reached = reachOfEntity(view, entity);
    return { ...base, state: view.state, ...reached };
  }
  if (change.adds) return { ...base, ...readAddedData(view, change) };
  // A target this migration itself adds is read the way its adding change was.
  const added = addedByThisMigration.get(change.target);
  if (added) return { ...base, state: 'added-data', outcome: added.outcome, contexts: added.contexts, domains: added.domains };
  return { ...base, state: view.state, outcome: 'unresolved', contexts: [], domains: [] };
}

/** An added entity the state at hand does not hold, read from the change's own typed data. */
function readAddedData(view: ReachView, change: ReachChange): Pick<ReachTrace, 'state' | 'outcome' | 'contexts' | 'domains'> {
  const target = change.target ?? '';
  const addsContext = change.addedType === 'context';
  if (addsContext) return { state: 'added-data', outcome: 'context', contexts: [target], domains: [] };
  if (CONTEXT_ID.test(target)) return { state: 'added-data', outcome: 'context', contexts: [target], domains: [] };
  if (DOMAIN_ID.test(target)) return { state: 'added-data', outcome: 'domain', contexts: [], domains: [target] };
  if (change.addedUnder) {
    const parent = resolveOne(view, change.addedUnder);
    if (parent && parent.type === ENTITY_TYPE.Context) {
      const domain = domainOfContext(membershipOf(view), parent.id);
      return { state: 'added-data', outcome: 'context', contexts: [parent.id], domains: domain ? [domain] : [] };
    }
  }
  return { state: 'added-data', outcome: 'unresolved', contexts: [], domains: [] };
}

/**
 * Derive a migration's reach from its changes and combine it with the reach it states.
 *
 * @param changes the migration's changes (`migrationChanges`)
 * @param declared the migration's own `reach`, if it states one
 * @param view the model state its targets are read against
 */
export function deriveMigrationReach(changes: ReachChange[], declared: unknown, view: ReachView): MigrationReach {
  const membership = membershipOf(view);
  const contexts = new Map<string, ReachItem>();
  const domains = new Map<string, ReachItem>();
  const traces: ReachTrace[] = [];
  let notDerived = 0;

  const note = (map: Map<string, ReachItem>, key: string, item: () => ReachItem, source?: string): void => {
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item());
      return;
    }
    if (source && !existing.sources.includes(source)) existing.sources.push(source);
  };

  // What each entity this migration adds reaches, so a later change naming it reads the same.
  const addedByThisMigration = new Map<string, ReachTrace>();
  for (const change of changes) {
    if (!change.adds || !change.target) continue;
    if (resolveOne(view, change.target)) continue;
    const read = readAddedData(view, change);
    if (read.outcome === 'unresolved') continue;
    addedByThisMigration.set(change.target, { source: change.source, kind: change.kind, target: change.target, ...read });
  }

  for (const change of changes) {
    const read = readChange(view, change, addedByThisMigration);
    if (read.contexts.length === 0 && read.domains.length === 0) notDerived += 1;
    for (const id of read.contexts) {
      const known = membership.byId.has(id);
      note(contexts, id, () => ({ id: known ? displayOf(membership, id) : id, ...(known ? { entity: id } : {}), provenance: 'derived', sources: [change.source] }), change.source);
    }
    for (const id of read.domains) {
      const known = membership.byId.has(id);
      note(domains, id, () => ({ id: known ? displayOf(membership, id) : id, ...(known ? { entity: id } : {}), provenance: 'derived', sources: [change.source] }), change.source);
    }
    traces.push({
      ...read,
      contexts: read.contexts.map(id => displayOf(membership, id)),
      domains: read.domains.map(id => displayOf(membership, id)),
    });
  }

  const stated = asRecord(declared);
  const statedList = (key: string): string[] => {
    const list = stated?.[key];
    return Array.isArray(list) ? list.filter((value): value is string => typeof value === 'string' && value !== '') : [];
  };
  const declare = (map: Map<string, ReachItem>, ref: string): void => {
    const entity = resolveOne(view, ref);
    const key = entity ? entity.id : ref;
    const existing = map.get(key);
    if (existing) {
      if (existing.provenance === 'derived') existing.provenance = 'both';
      return;
    }
    map.set(key, { id: ref, ...(entity ? { entity: entity.id } : {}), provenance: 'declared', sources: [] });
  };
  for (const ref of statedList('bounded_context_refs')) declare(contexts, ref);
  for (const ref of statedList('domain_refs')) declare(domains, ref);

  return {
    contexts: [...contexts.values()],
    domains: [...domains.values()],
    traces,
    not_derived: notDerived,
    derivation: derivationOf(changes.length, notDerived),
    declared: stated !== null,
  };
}

function derivationOf(changeCount: number, notDerived: number): MigrationReach['derivation'] {
  if (changeCount === 0) return 'unknown';
  if (notDerived === changeCount) return 'unknown';
  if (notDerived === 0) return 'complete';
  return 'partial';
}

/** The state the builder's single model is, relative to a migration with this status. */
export function stateForStatus(status: unknown): 'before' | 'after' {
  return status === 'applied' || status === 'completed' ? 'after' : 'before';
}

/**
 * Annotate every Migration node with `_reach` and draw one `migration_reach` edge per context or
 * domain that resolves to a graph entity. Runs after membership, coverage and language edges exist.
 * The tracked register is not part of the built model; its readers call `deriveMigrationReach` with
 * `migrationChanges('tracked', entry)` and the state they hold.
 *
 * DERIVED ONCE, AT THE BUILD. The reach describes a migration against the model the build read, with
 * the documents that hold its changes. A node that already carries `_reach` keeps it, and its edges
 * are drawn from it: replaying migrations re-runs this pass over a later state and without the
 * migration documents, and re-deriving there would rewrite the node with a reach read against a state
 * the migration was not written for, so a state comparison would report every migration as changed
 * although no migration changed it. An edge to an entity the later state no longer holds is not drawn.
 */
export function extractMigrationReachRelations(
  entities: Entity[],
  relations: Relation[],
  documentRoots: Map<string, FieldMap>,
): Relation[] {
  const reachRelations: Relation[] = [];
  const present = new Set(entities.map(entity => entity.id));
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Migration) continue;
    const data = asRecord(entity.data);
    if (!data) continue;
    const built = asRecord(data._reach) as MigrationReach | null;
    const reach = built ?? deriveMigrationReach(
      data._genre === 'change-program'
        ? migrationChanges('document', data, documentRoots.get(entity.fileOrigin ?? '') ?? {})
        : migrationChanges('register', data),
      data.reach,
      { entities, relations, state: stateForStatus(data.status) },
    );
    if (!built) data._reach = reach;
    for (const item of [...reach.contexts, ...reach.domains]) {
      if (!item.entity) continue;
      if (built && !present.has(item.entity)) continue;
      reachRelations.push({
        id: `${entity.id}--${RELATION_TYPE.MigrationReach}--${item.entity}`,
        source_entity_id: entity.id,
        target_entity_id: item.entity,
        type: RELATION_TYPE.MigrationReach,
        data: { provenance: item.provenance },
      });
    }
  }
  return reachRelations;
}
