import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/** A bounded context's `domain_ref` names a Domain in this shape. */
const DOMAIN_ID_PATTERN = /^DMN\d{3,}$/;
/** ...or a Subdomain in this one - the v2.8.7 shape (see below). Anything matching neither is an
 *  older model's slice-name form, which this extractor must pass through in silence. */
const SUBDOMAIN_ID_PATTERN = /^SDM\d{3,}$/;

/**
 * Edges from the v2.8.6/v2.8.7 problem-space registry (`blueprint.yaml` `domains:`):
 *
 *   - `SubdomainOfDomain` (Subdomain -> Domain), one per declared subdomain. Read from `_domain`,
 *     the positional-placement field the entity extractor (`entities/domains.ts`) writes onto
 *     every Subdomain - the same convention `_context`/`_party` use for arch nesting. Resolved
 *     through the shared `resolveOrPlaceholder`, so a Subdomain whose Domain is somehow absent
 *     from the model still gets an edge, to a Missing placeholder, rather than silently dropping
 *     the fact.
 *
 *   - A bounded context's `domain_ref` (arch.schema `parties[].contexts[]` or root `contexts[]`)
 *     is ONE reference that may name either a Domain or a Subdomain (v2.8.7 owner's ruling: "BC is
 *     connected to domain or subdomain, one ref, if BC is connected to a subdomain it is also
 *     connected to domain covering this subdomain"). Three shapes:
 *
 *     1. Matches `^DMN\d{3,}$`: one `ContextRealizesDomain` edge (BoundedContext -> Domain). A
 *        value that matches the pattern but names no declared Domain still resolves to a Missing
 *        placeholder, exactly as an unresolvable `system_ref` or `goal_refs` entry does elsewhere
 *        in this package (see `resolver.ts`).
 *
 *     2. Matches `^SDM\d{3,}$`: a declared `ContextRealizesSubdomain` edge (BoundedContext ->
 *        Subdomain, resolved/placeholdered the same way), PLUS a derived `ContextRealizesDomain`
 *        edge (BoundedContext -> Domain) to the Subdomain's own parent, read from that Subdomain
 *        entity's `_domain` field - the same field `SubdomainOfDomain` above reads. The derived
 *        edge reuses `ContextRealizesDomain` rather than a distinct type, so any consumer grouping
 *        contexts by domain keeps working unchanged whether the context named the domain directly
 *        or one of its subdomains - that is the whole point of the ruling. If the subdomain id
 *        resolves to no declared Subdomain, there is no parent to derive from: the declared edge
 *        still resolves to a Missing placeholder, but no domain edge is emitted.
 *
 *     3. Anything else (e.g. "orders", an older model's slice folder name): out of scope for this
 *        registry - no relation, no placeholder, no error - because a slice name is not a
 *        reference this edge can resolve or deny.
 *
 *     A single context's `domain_ref` is one string, so a single context cannot itself request the
 *     same `ContextRealizesDomain` target twice; `addContextRealizesDomain` still de-duplicates by
 *     relation id, the way the file already keeps ids unique, as a safeguard against that changing.
 *
 *   `Relation` (`model/types.ts`) carries no dedicated "this edge is derived" field - only a
 *   generic `data?: Record<string, unknown>` bag, which other derived-vs-declared distinctions in
 *   this package (`systemRef.ts`'s `data.inherited`) use for their OWN specific facts. There is no
 *   established `data` key whose purpose is "derived" in general, so none is invented here per
 *   the brief; the derived edge is byte-for-byte the same shape as a directly-declared one.
 */
export function extractDomainRegistryRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];
  const seenContextRealizesDomain = new Set<string>();

  const addContextRealizesDomain = (contextEntityId: string, targetId: string): void => {
    const id = `${contextEntityId}--${RELATION_TYPE.ContextRealizesDomain}--${targetId}`;
    if (seenContextRealizesDomain.has(id)) return;
    seenContextRealizesDomain.add(id);
    relations.push({
      id,
      source_entity_id: contextEntityId,
      target_entity_id: targetId,
      type: RELATION_TYPE.ContextRealizesDomain,
    });
  };

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Subdomain) continue;
    const data = entity.data as Record<string, unknown> | undefined;
    const domainRef = data?._domain;
    if (typeof domainRef !== 'string' || domainRef.length === 0) continue;

    const targetId = resolveOrPlaceholder(domainRef, entityDomain(entity), entities, placeholders);
    relations.push({
      id: `${entity.id}--${RELATION_TYPE.SubdomainOfDomain}--${targetId}`,
      source_entity_id: entity.id,
      target_entity_id: targetId,
      type: RELATION_TYPE.SubdomainOfDomain,
    });
  }

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Context) continue;
    const data = entity.data as Record<string, unknown> | undefined;
    const domainRef = data?.domain_ref;
    if (typeof domainRef !== 'string' || domainRef.length === 0) continue;

    if (DOMAIN_ID_PATTERN.test(domainRef)) {
      const targetId = resolveOrPlaceholder(domainRef, entityDomain(entity), entities, placeholders);
      addContextRealizesDomain(entity.id, targetId);
      continue;
    }

    if (SUBDOMAIN_ID_PATTERN.test(domainRef)) {
      const subdomainTargetId = resolveOrPlaceholder(
        domainRef,
        entityDomain(entity),
        entities,
        placeholders
      );
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.ContextRealizesSubdomain}--${subdomainTargetId}`,
        source_entity_id: entity.id,
        target_entity_id: subdomainTargetId,
        type: RELATION_TYPE.ContextRealizesSubdomain,
      });

      // Resolved to a real Subdomain (not a Missing placeholder): derive the parent Domain edge
      // from the same `_domain` placement field `SubdomainOfDomain` reads above. A dangling
      // SDM### has no parent to derive from, so no domain edge follows it.
      const subdomainEntity = entities.find((candidate) => candidate.id === subdomainTargetId);
      if (subdomainEntity && subdomainEntity.type === ENTITY_TYPE.Subdomain) {
        const subdomainData = subdomainEntity.data as Record<string, unknown> | undefined;
        const parentDomainRef = subdomainData?._domain;
        if (typeof parentDomainRef === 'string' && parentDomainRef.length > 0) {
          const domainTargetId = resolveOrPlaceholder(
            parentDomainRef,
            entityDomain(subdomainEntity),
            entities,
            placeholders
          );
          addContextRealizesDomain(entity.id, domainTargetId);
        }
      }
      continue;
    }

    // slice-name form (older model): no relation, no error
  }

  return relations;
}
