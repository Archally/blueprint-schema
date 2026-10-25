/**
 * Re-derive, after a migration, every relation the build derives from entity data.
 *
 * Most relations are not authored as edges: the build derives them from fields - `handled_by` from
 * a contract's `expose:`/`send:`/`provide:`, `provides` and `contract_sends` from a service's
 * `contracts:`, `context_realizes_domain` from a context's `domain_ref`, `owned_by` from an
 * `owned_by` or a file default, `context_uses_concept` from the finished membership, and so on. A
 * migration is applied to a model that is already built, so an operation it adds, a contract it
 * extends or a context it introduces is drawn on nothing unless these are derived again. This module
 * derives them again with the build's own function, `buildRelations`, over the migrated entities, so
 * the edge after a migration is the edge a model written in that shape has when it is built.
 *
 * It applies the DIFFERENCE between the derivation before the migration and the derivation after
 * it, not the derivation itself:
 *
 * - an edge the derivation yields before and after keeps its place in `model.relations`, and takes
 *   the derived value when the derivation changed it;
 * - an edge the derivation stops yielding is removed;
 * - an edge it starts yielding is appended, unless the model already holds it: a migration's
 *   `relationships:` block names an edge `<source>--<type>--<target>`, the id the derivation gives
 *   the same edge, so an edge stated by hand and derived as well is held once;
 * - an edge the derivation never yielded - one a migration stated, or a derived one a migration
 *   redirected - is left as the migration left it.
 *
 * So a migration that changes nothing the derivation reads changes no relation, and a relationship a
 * migration states by hand is never overwritten by the derivation of an unrelated field.
 *
 * Two kinds of entity are derived too, and follow the same rule. The Contract entities the build
 * extracts from a service's `contracts:` map are re-extracted for a service whose map the migration
 * changed, so a contract a migration adds or extends is a node with edges. The placeholder and code
 * file entities `buildRelations` creates are added when a new edge needs one and removed when no
 * edge needs it any more. And an event's reach is annotated again from the finished relations, as
 * the build annotates it.
 *
 * The build also reads the file an entity sits in. An entity a migration adds is declared in the
 * migration, so the derivation reads it from the file `_written_in` names (see `placeAsWritten.ts`)
 * where it has one, and from its `fileOrigin` otherwise; a contract takes it from its service. The
 * entity's `fileOrigin` is not changed.
 */
import type { BlueprintModel, Entity, Relation } from '../model/types.js';
import { ENTITY_TYPE } from '../model/entityTypes.js';
import { buildRelations } from '../extraction/relations/index.js';
import { annotateEventReach } from '../extraction/entities/eventReach.js';
import { WRITTEN_IN, writtenFileOf } from './changes/placeAsWritten.js';

/** Entities `buildRelations` creates rather than reads. */
const BUILT_TYPES: ReadonlySet<string> = new Set([ENTITY_TYPE.Missing, ENTITY_TYPE.CodeFile]);

/** The keys that place an arch entity: the extractor copies them from context to service to contract. */
const PLACEMENT_KEYS = ['_party', '_root', '_scope'] as const;

/** What the derivation yielded for one state of a model. */
export interface DerivedState {
  /** Derived relations by id. */
  relations: Map<string, Relation>;
  /** Entities the derivation created (placeholders, code files) by id. */
  entities: Map<string, Entity>;
  /** Per service id: its contracts and placement as JSON, to see which services a migration changed. */
  services: Map<string, { key: string; state: string }>;
}

function dataOf(entity: Entity): Record<string, unknown> {
  return (entity.data as Record<string, unknown> | undefined) ?? {};
}

function nameOf(service: Entity): string {
  const name = dataOf(service).name;
  return typeof name === 'string' ? name : service.displayId;
}

/** (party, context, service): what ties a Contract entity to the service that declares it. */
function serviceKey(party: unknown, context: unknown, service: unknown): string {
  return [party, context, service].map((part) => (typeof part === 'string' ? part : '')).join('::');
}

function serviceKeyOf(service: Entity): string {
  const data = dataOf(service);
  return serviceKey(data._party, data._context, nameOf(service));
}

function contractServiceKey(contract: Entity): string {
  const data = dataOf(contract);
  return serviceKey(data._party, data._context, data._service);
}

/**
 * The entities as the build reads them: one that records the file it would be written into is read
 * from that file. A copy, sharing its `data`, so an annotation made on it is made on the entity.
 */
function asWritten(entities: Entity[]): Entity[] {
  return entities.map((entity) => {
    const file = writtenFileOf(entity);
    return file === entity.fileOrigin ? entity : { ...entity, fileOrigin: file };
  });
}

function servicesOf(model: BlueprintModel): Map<string, { key: string; state: string }> {
  const services = new Map<string, { key: string; state: string }>();
  for (const entity of model.entities) {
    if (entity.type !== ENTITY_TYPE.Service) continue;
    const data = dataOf(entity);
    const placement = PLACEMENT_KEYS.map((key) => data[key]);
    services.set(entity.id, { key: serviceKeyOf(entity), state: JSON.stringify([data.contracts ?? null, placement]) });
  }
  return services;
}

/**
 * Run the build's relation pass over the model's entities. The story pass warns about every step
 * it cannot resolve; the build already said so once for each, so the warnings are held back here
 * rather than repeated for every migration replayed.
 */
export function deriveFrom(model: BlueprintModel): DerivedState {
  const input = asWritten(model.entities.filter((entity) => !BUILT_TYPES.has(entity.type)));
  const warn = console.warn;
  let built: ReturnType<typeof buildRelations>;
  console.warn = () => {};
  try {
    built = buildRelations(input, {});
  } finally {
    console.warn = warn;
  }
  const relations = new Map<string, Relation>();
  for (const relation of built.relations) if (!relations.has(relation.id)) relations.set(relation.id, relation);
  const entities = new Map<string, Entity>();
  for (const entity of built.addedEntities) if (!entities.has(entity.id)) entities.set(entity.id, entity);
  return { relations, entities, services: servicesOf(model) };
}

/**
 * Re-extract the Contract entities of every service whose `contracts:` (or placement) the migration
 * changed, as the arch extractor shapes them. A contract type the service still declares keeps its
 * entity id and place; one it no longer declares is removed; a new one is appended.
 */
function syncContracts(model: BlueprintModel, before: Map<string, { key: string; state: string }>): void {
  const now = servicesOf(model);
  const changedKeys = new Set<string>();
  for (const [id, previous] of before) {
    const current = now.get(id);
    if (!current || current.state !== previous.state || current.key !== previous.key) changedKeys.add(previous.key);
  }
  const changedServices = model.entities.filter((entity) => {
    if (entity.type !== ENTITY_TYPE.Service) return false;
    const previous = before.get(entity.id);
    const current = now.get(entity.id)!;
    return !previous || previous.state !== current.state || previous.key !== current.key;
  });
  if (changedKeys.size === 0 && changedServices.length === 0) return;
  for (const service of changedServices) changedKeys.add(serviceKeyOf(service));

  const fresh = new Map<string, Entity>();
  for (const service of changedServices) {
    const data = dataOf(service);
    const contracts = data.contracts;
    if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) continue;
    const placement: Record<string, unknown> = {};
    for (const key of [...PLACEMENT_KEYS, WRITTEN_IN]) if (data[key] !== undefined) placement[key] = data[key];
    const serviceName = nameOf(service);
    for (const [contractType, contract] of Object.entries(contracts as Record<string, unknown>)) {
      if (!contract || typeof contract !== 'object') continue;
      fresh.set(`${serviceKeyOf(service)}::${contractType}`, {
        id: `${service.id}.${contractType}`,
        displayId: `${serviceName}.${contractType}`,
        type: ENTITY_TYPE.Contract,
        layer: service.layer,
        fileOrigin: service.fileOrigin,
        data: {
          ...structuredClone(contract as Record<string, unknown>),
          _contractType: contractType,
          _service: serviceName,
          _context: data._context,
          ...placement,
        },
      });
    }
  }

  const placed = new Set<string>();
  const entities: Entity[] = [];
  for (const entity of model.entities) {
    if (entity.type !== ENTITY_TYPE.Contract || !changedKeys.has(contractServiceKey(entity))) {
      entities.push(entity);
      continue;
    }
    const key = `${contractServiceKey(entity)}::${String(dataOf(entity)._contractType ?? '')}`;
    const replacement = fresh.get(key);
    if (!replacement || placed.has(key)) continue;
    entities.push({ ...replacement, id: entity.id });
    placed.add(key);
  }
  for (const [key, contract] of fresh) if (!placed.has(key)) entities.push(contract);
  model.entities = entities;
}

function sameRelation(a: Relation, b: Relation): boolean {
  return (
    a.type === b.type &&
    a.source_entity_id === b.source_entity_id &&
    a.target_entity_id === b.target_entity_id &&
    a.predicate === b.predicate &&
    JSON.stringify(a.data ?? null) === JSON.stringify(b.data ?? null)
  );
}

/**
 * Bring the model's derived relations and entities from what `before` derived to what its entities
 * derive now. Returns the new derivation, to be passed as `before` for the next migration.
 */
export function rederiveRelations(model: BlueprintModel, before: DerivedState): DerivedState {
  syncContracts(model, before.services);
  const after = deriveFrom(model);

  const relations: Relation[] = [];
  const present = new Set<string>();
  for (const relation of model.relations) {
    const was = before.relations.get(relation.id);
    if (was) {
      const now = after.relations.get(relation.id);
      if (!now) continue;
      if (!sameRelation(was, now)) {
        relations.push(now);
        present.add(relation.id);
        continue;
      }
    }
    relations.push(relation);
    present.add(relation.id);
  }
  for (const [id, relation] of after.relations) {
    if (present.has(id) || before.relations.has(id)) continue;
    relations.push(relation);
    present.add(id);
  }
  model.relations = relations;

  const entityIds = new Set(model.entities.map((entity) => entity.id));
  const referenced = new Set<string>();
  for (const relation of relations) {
    referenced.add(relation.source_entity_id);
    referenced.add(relation.target_entity_id);
  }
  model.entities = model.entities.filter(
    (entity) => !before.entities.has(entity.id) || after.entities.has(entity.id) || referenced.has(entity.id),
  );
  for (const [id, entity] of after.entities) {
    if (!entityIds.has(id) && referenced.has(id)) model.entities.push(entity);
  }

  annotateEventReach(asWritten(model.entities), model.relations);
  return after;
}
