import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['arch']!;

/**
 * Extract all arch entities from one arch document.
 *
 * Schema shape (arrays):
 *   parties: [{ name, kind, env, contexts: [{ name, kind, summary, services: [{ name, ... contracts: {} }] }] }]
 *
 * Produces Context, Service, and Contract entities.
 * Internal id uses fully qualified path (party.context[.service[.contractType]]) to
 * prevent collisions when multiple parties or contexts share the same name.
 */
export function extractArch(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const parties = data.parties as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parties)) return entities;

  // Phase 2 step-03: per-arch.yaml `scope:` field (e.g. "customers")
  // propagates onto Party/Context/Service/Contract entities so the
  // resolver can match scope-only domain artifacts (concepts.yaml has
  // `scope:` but no `name:`) to their owning Context entities.
  const scope = typeof doc.scope === 'string' && doc.scope.length > 0 ? doc.scope : undefined;

  for (const party of parties) {
    const partyName = party.name as string | undefined;
    if (!partyName) continue;

    // Emit Party entity (DQ-ARCH-16, step-08c). Always emitted, even when
    // `contexts` is empty — supports external-party rendering for parties
    // declared as known integration partners (e.g. root-level parties such as
    // CRM, ESB or a document-management system that own no context of their own).
    const partyId = makeInternalId(doc.scope, doc.filePath, partyName);
    entities.push({
      id: partyId,
      displayId: partyName,
      type: ENTITY_TYPE.Party,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: party.description != null ? String(party.description) : undefined,
      data: { ...party, ...(scope ? { _scope: scope } : {}) },
    });

    const contexts = party.contexts as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(contexts)) continue;

    for (const context of contexts) {
      const contextName = context.name as string | undefined;
      if (!contextName) continue;

      const contextId = makeInternalId(doc.scope, doc.filePath, `${partyName}.${contextName}`);
      entities.push({
        id: contextId,
        displayId: contextName,
        type: ENTITY_TYPE.Context,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: context.summary != null ? String(context.summary) : undefined,
        data: { ...context, _party: partyName, ...(scope ? { _scope: scope } : {}) },
      });

      const services = context.services as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(services)) continue;

      for (const service of services) {
        const serviceName = service.name as string | undefined;
        if (!serviceName) continue;

        const serviceId = makeInternalId(
          doc.scope,
          doc.filePath,
          `${partyName}.${contextName}.${serviceName}`
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
            _party: partyName,
            ...(scope ? { _scope: scope } : {}),
          },
        });

        const contracts = service.contracts as Record<string, unknown> | undefined;
        if (!contracts || typeof contracts !== 'object') continue;

        for (const [contractType, contract] of Object.entries(contracts)) {
          const contractId = makeInternalId(
            doc.scope,
            doc.filePath,
            `${partyName}.${contextName}.${serviceName}.${contractType}`
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
              _party: partyName,
              ...(scope ? { _scope: scope } : {}),
            },
          });
        }
      }
    }
  }

  return entities;
}
