import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['blueprint']!;

/**
 * Extract Domain and Subdomain entities from the model root document's `domains:` registry
 * (v2.8.6 problem-space registry). This lives under the `blueprint` schema type - the document
 * is `blueprint.yaml` itself, so the layer is the one `SCHEMA_TYPE_TO_LAYER` already assigns that
 * schema type, the same way `extractArch` takes its layer from `SCHEMA_TYPE_TO_LAYER['arch']`.
 *
 * Exactly two levels: a Domain (`DMN###`) may nest `subdomains[]`, and a subdomain (`SDM###`)
 * declares no subdomains of its own - the walk does not recurse.
 *
 * A Subdomain entity carries `_domain`, the declared id of the Domain it is nested under, the way
 * a nested arch service carries `_context`/`_party` (see `arch.ts`, `systemRef.ts`). The relation
 * builder (`extraction/relations/domains.ts`) reads it to draw the parent edge instead of
 * re-walking the document.
 */
export function extractDomains(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const domains = data.domains as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(domains)) return entities;

  for (const domain of domains) {
    if (!domain || typeof domain !== 'object' || domain.id == null) continue;
    const displayId = String(domain.id);
    const name = domain.name != null ? String(domain.name) : undefined;
    const description = domain.description != null ? String(domain.description) : undefined;

    entities.push({
      id: makeInternalId(doc.scope, doc.filePath, displayId),
      displayId,
      type: ENTITY_TYPE.Domain,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: name,
      term: name,
      description,
      // The raw entry as declared, subdomains included - a consumer that wants the nested list
      // reads it here rather than re-deriving it from the flattened Subdomain entities.
      data: domain,
    });

    const subdomains = domain.subdomains as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(subdomains)) continue;

    for (const subdomain of subdomains) {
      if (!subdomain || typeof subdomain !== 'object' || subdomain.id == null) continue;
      const subdomainDisplayId = String(subdomain.id);
      const subdomainName = subdomain.name != null ? String(subdomain.name) : undefined;
      const subdomainDescription =
        subdomain.description != null ? String(subdomain.description) : undefined;

      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, subdomainDisplayId),
        displayId: subdomainDisplayId,
        type: ENTITY_TYPE.Subdomain,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: subdomainName,
        term: subdomainName,
        description: subdomainDescription,
        data: { ...subdomain, _domain: displayId },
      });
    }
  }

  return entities;
}
