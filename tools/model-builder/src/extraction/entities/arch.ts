import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['arch']!;

/**
 * Extract all arch entities from one arch document.
 *
 * Two declaration shapes, one walk:
 *   parties:  [{ name, kind, env, contexts: [{ name, kind, services: [{ name, contracts: {} }] }] }]
 *   contexts: [{ name, kind, services: [{ name, system_ref, ... }] }]           (root-declared)
 *
 * A nested context carries `_party`, the name of the party it sits under, and so do its services
 * and contracts. A root-declared context carries `_root: true` and no `_party`; its services name
 * their system through `system_ref`, or through the document's default that `annotateSystemDefaults`
 * writes under `_system_ref_default`. The relation builder turns both shapes into the same
 * `system_ref` and `spans` edges, so a consumer of the graph never needs to know which one the
 * author wrote.
 *
 * Produces Party, Context, Service, Contract and Probe entities. The internal id is the fully
 * qualified path (party.context[.service[.contractType]]); a root-declared context's party segment
 * is empty (`.context`), which no nested path can produce, so the two shapes cannot collide. A
 * probe is declared at the document root and takes neither segment, so its path is the bare probe
 * id, which neither of the other two shapes can produce.
 */
export function extractArch(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  // Phase 2 step-03: per-arch.yaml `scope:` field (e.g. "customers")
  // propagates onto Party/Context/Service/Contract entities so the
  // resolver can match scope-only domain artifacts (concepts.yaml has
  // `scope:` but no `name:`) to their owning Context entities.
  const scope = typeof doc.scope === 'string' && doc.scope.length > 0 ? doc.scope : undefined;
  const scoped = scope ? { _scope: scope } : {};

  const parties = data.parties as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(parties)) {
    for (const party of parties) {
      const partyName = party.name as string | undefined;
      if (!partyName) continue;

      // Emit Party entity (DQ-ARCH-16, step-08c). Always emitted, even when `contexts` is empty or
      // absent: a party declared whole carries no contexts of its own, and an external party (a
      // CRM, an ESB) declared as a known integration partner renders as an actor node.
      const partyId = makeInternalId(doc.scope, doc.filePath, partyName);
      entities.push({
        id: partyId,
        displayId: partyName,
        type: ENTITY_TYPE.Party,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: party.description != null ? String(party.description) : undefined,
        data: { ...party, ...scoped },
      });

      const contexts = party.contexts as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(contexts)) continue;
      for (const context of contexts) emitContext(context, partyName);
    }
  }

  const rootContexts = data.contexts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(rootContexts)) {
    for (const context of rootContexts) emitContext(context, undefined);
  }

  // Probes (v2.8.44). Root-level, so no party or context segment enters the path: an instrument is
  // not a part of the system it reads. Every declared field is carried onto the node, `blind_spots`
  // included and whole - summarising an omission at extraction time would put the judgement about
  // what it costs a reader in the wrong place, and the omissions are why the node exists at all.
  const probes = data.probes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(probes)) {
    for (const probe of probes) {
      const probeId = probe.id as string | undefined;
      if (!probeId) continue;
      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, probeId),
        displayId: probeId,
        type: ENTITY_TYPE.Probe,
        layer: LAYER,
        fileOrigin: doc.filePath,
        // A probe's displayId is its id, so its human name has to reach `term` or it reaches no
        // reader: `term` is the Name column in `bp entities` and `bp query`, and the `name` field
        // the text search ranks above the body. This is the convention every id-keyed entity
        // already follows (Decision, Domain, Migration), not a new one.
        term: probe.name != null ? String(probe.name) : undefined,
        summary: probe.summary != null ? String(probe.summary) : undefined,
        data: { ...probe, ...scoped },
      });
    }
  }

  return entities;

  /** One context with its services and contracts, placed under `partyName` or, without one, at the root. */
  function emitContext(context: Record<string, unknown>, partyName: string | undefined): void {
    const contextName = context.name as string | undefined;
    if (!contextName) return;

    const pathPrefix = partyName ?? '';
    const placement = partyName ? { _party: partyName } : { _root: true };

    const contextId = makeInternalId(doc.scope, doc.filePath, `${pathPrefix}.${contextName}`);
    entities.push({
      id: contextId,
      displayId: contextName,
      type: ENTITY_TYPE.Context,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: context.summary != null ? String(context.summary) : undefined,
      data: { ...context, ...placement, ...scoped },
    });

    const services = context.services as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(services)) return;

    for (const service of services) {
      const serviceName = service.name as string | undefined;
      if (!serviceName) continue;

      const serviceId = makeInternalId(
        doc.scope,
        doc.filePath,
        `${pathPrefix}.${contextName}.${serviceName}`
      );
      entities.push({
        id: serviceId,
        displayId: serviceName,
        type: ENTITY_TYPE.Service,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: service.summary != null ? String(service.summary) : undefined,
        data: {
          ...service,
          _context: contextName,
          ...placement,
          ...scoped,
        },
      });

      const contracts = service.contracts as Record<string, unknown> | undefined;
      if (!contracts || typeof contracts !== 'object') continue;

      for (const [contractType, contract] of Object.entries(contracts)) {
        const contractId = makeInternalId(
          doc.scope,
          doc.filePath,
          `${pathPrefix}.${contextName}.${serviceName}.${contractType}`
        );
        entities.push({
          id: contractId,
          displayId: `${serviceName}.${contractType}`,
          type: ENTITY_TYPE.Contract,
          layer: LAYER,
          fileOrigin: doc.filePath,
          data: {
            ...(contract as Record<string, unknown>),
            _contractType: contractType,
            _service: serviceName,
            _context: contextName,
            ...placement,
            ...scoped,
          },
        });
      }
    }
  }
}
