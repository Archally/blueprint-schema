import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { indexDeclarations, resolveReference, type RefDeclaration, type RefIndex } from './refResolution.js';
import { partyIdentityKey } from '../entities/partyIdentity.js';

/**
 * Extract structural containment relations from arch entities.
 * These are not ref-based — they derive from the YAML nesting hierarchy
 * preserved via _party, _context, _service fields in entity.data. A root-declared context and
 * everything under it carry `_root` instead of `_party`, and key on an empty party segment.
 *
 * - Context → Service (contains)
 * - Service → Contract (provides)
 */
function envelopeOf(data: Record<string, unknown> | undefined): string | undefined {
  if (typeof data?._party === 'string') return data._party;
  return data?._root === true ? '' : undefined;
}
export function extractArchRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  // Build lookup indexes keyed by structural coordinates so we can find
  // parent entities for each service and contract in O(1).
  const contextIndex = new Map<string, string>(); // "{fileOrigin}|{party}|{context}" → entity id
  const serviceIndex = new Map<string, string>(); // "{fileOrigin}|{party}|{context}|{service}" → entity id

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;
    if (entity.type === ENTITY_TYPE.Context) {
      const party = envelopeOf(data);
      if (party !== undefined) {
        const key = `${entity.fileOrigin ?? ''}|${party}|${entity.displayId}`;
        contextIndex.set(key, entity.id);
      }
    }
    if (entity.type === ENTITY_TYPE.Service) {
      const party = envelopeOf(data);
      const context = data?._context as string | undefined;
      if (party !== undefined && context) {
        const key = `${entity.fileOrigin ?? ''}|${party}|${context}|${entity.displayId}`;
        serviceIndex.set(key, entity.id);
      }
    }
  }

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;

    if (entity.type === ENTITY_TYPE.Service) {
      const party = envelopeOf(data);
      const context = data?._context as string | undefined;
      if (party === undefined || !context) continue;
      const contextKey = `${entity.fileOrigin ?? ''}|${party}|${context}`;
      const contextId = contextIndex.get(contextKey);
      if (!contextId) continue;
      relations.push({
        id: `${contextId}--${RELATION_TYPE.Contains}--${entity.id}`,
        source_entity_id: contextId,
        target_entity_id: entity.id,
        type: RELATION_TYPE.Contains,
      });
    }

    if (entity.type === ENTITY_TYPE.Contract) {
      const party = envelopeOf(data);
      const context = data?._context as string | undefined;
      const service = data?._service as string | undefined;
      if (party === undefined || !context || !service) continue;
      const serviceKey = `${entity.fileOrigin ?? ''}|${party}|${context}|${service}`;
      const serviceId = serviceIndex.get(serviceKey);
      if (!serviceId) continue;
      relations.push({
        id: `${serviceId}--${RELATION_TYPE.Provides}--${entity.id}`,
        source_entity_id: serviceId,
        target_entity_id: entity.id,
        type: RELATION_TYPE.Provides,
      });
    }
  }

  return relations;
}

/**
 * What a service is built on (`imports`) and the services it depends on while running (`uses`), as
 * edges: `service_imports` (Service -> Service or Package) and `service_uses` (Service -> Service).
 *
 * Each item resolves by the shared resolution function against the id each target DECLARES
 * (`id: SVC###` on a service, `id: PKG###` on a package), never against a name, which is what a
 * service's `displayId` holds. A reference resolves to the same string and nothing else, so `SVC001`
 * does not reach a service declared `shop.SVC001`, nor `PKG002` a package declared `platform.PKG002`.
 * `imports` resolves against services and packages together, in one index, because one list holds
 * both; `uses` resolves against services only, because a package does not run. An item that resolves
 * to no target, or to several, draws nothing: the validator reports it, and a placeholder would show
 * a dependency on something nobody declared.
 *
 * One edge per (relation, pair): a target named twice in one list is one edge. A target named in
 * both lists is two edges of two types, never merged - building on a library and calling a running
 * service are two statements. A service naming itself draws a self-loop, unlike the context
 * dependencies, which drop one: a self-import is a statement a cycle check must be able to see.
 */
export function extractServiceDependencyRelations(entities: Entity[]): Relation[] {
  const serviceDeclarations: RefDeclaration[] = [];
  const packageDeclarations: RefDeclaration[] = [];
  for (const entity of entities) {
    if (entity.type === ENTITY_TYPE.Package) {
      // A package's displayId IS its declared id (see the arch entity extractor).
      packageDeclarations.push({ id: entity.displayId, handle: entity.id });
      continue;
    }
    if (entity.type !== ENTITY_TYPE.Service) continue;
    const declaredId = (entity.data as Record<string, unknown> | undefined)?.id;
    if (typeof declaredId !== 'string') continue;
    if (declaredId.length === 0) continue;
    serviceDeclarations.push({ id: declaredId, handle: entity.id });
  }
  if (serviceDeclarations.length === 0) return [];
  const indexes: Record<string, RefIndex> = {
    imports: indexDeclarations([...serviceDeclarations, ...packageDeclarations]),
    uses: indexDeclarations(serviceDeclarations),
  };

  const relations: Relation[] = [];
  const emitted = new Set<string>();
  const fields: ReadonlyArray<[string, string]> = [
    ['imports', RELATION_TYPE.ServiceImports],
    ['uses', RELATION_TYPE.ServiceUses],
  ];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Service) continue;
    const data = (entity.data as Record<string, unknown> | undefined) ?? {};
    for (const [field, type] of fields) {
      const items = data[field];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (typeof item !== 'string' || item.length === 0) continue;
        const resolution = resolveReference(indexes[field]!, item);
        if (resolution.status !== 'resolved') continue;
        const id = `${entity.id}--${type}--${resolution.handle}`;
        if (emitted.has(id)) continue;
        emitted.add(id);
        relations.push({
          id,
          source_entity_id: entity.id,
          target_entity_id: resolution.handle,
          type,
        });
      }
    }
  }

  return relations;
}

/**
 * The party that supplies a package: Package -> Party (`package_vendor`), from `package.vendor_ref`.
 *
 * `vendor_ref` is a typed party reference, resolved against the id each party DECLARES, exactly as
 * written. A reference that resolves to no party, or to several, draws no edge and no placeholder: it
 * is already a cross-reference error with a file and a location, and an absent `vendor_ref` says the
 * supplier is not stated, which no edge should claim otherwise.
 */
export function extractPackageVendorRelations(entities: Entity[]): Relation[] {
  // A party is declared once per document that describes it (arch and organization); every row
  // declaring one id is one party, which the party fold merges, so any row is the party - the rule
  // `systemRef.ts` follows. The edge points at the first row and the fold moves it to the survivor.
  const parties: RefDeclaration[] = [];
  const partyRowByKey = new Map<string, Entity>();
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Party) continue;
    const declaredId = (entity.data as Record<string, unknown> | undefined)?.id;
    if (typeof declaredId !== 'string') continue;
    if (declaredId.length === 0) continue;
    const key = partyIdentityKey(entity);
    parties.push({ id: declaredId, handle: key });
    if (!partyRowByKey.has(key)) partyRowByKey.set(key, entity);
  }
  if (parties.length === 0) return [];
  const index = indexDeclarations(parties);

  const relations: Relation[] = [];
  const emitted = new Set<string>();
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Package) continue;
    const vendor = (entity.data as Record<string, unknown> | undefined)?.vendor_ref;
    if (typeof vendor !== 'string') continue;
    if (vendor.length === 0) continue;
    const resolution = resolveReference(index, vendor);
    const party = resolution.status === 'resolved' ? partyRowByKey.get(resolution.handle) : undefined;
    if (!party) continue;
    const id = `${entity.id}--${RELATION_TYPE.PackageVendor}--${party.id}`;
    if (emitted.has(id)) continue;
    emitted.add(id);
    relations.push({ id, source_entity_id: entity.id, target_entity_id: party.id, type: RELATION_TYPE.PackageVendor });
  }
  return relations;
}
