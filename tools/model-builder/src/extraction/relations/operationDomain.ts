import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { DOMAIN_REF_DEFAULT } from '../entities/domainDefaults.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * `Operation --operation_in_domain--> Domain`, from the document header rather than the operation.
 *
 * An operation declares no domain of its own by design, so this edge has exactly two sources and
 * they are tried in this order:
 *
 *   1. **The document's `domain_ref`**, carried onto the operation as `_domain_ref_default` by
 *      `annotateDomainDefaults` before extraction. Recorded as `resolution: 'file-header'`. A value
 *      that names no declared Domain still resolves to a Missing placeholder, the way an
 *      unresolvable `system_ref` does elsewhere in this package: the model made a statement and it
 *      is wrong, which is a different fact from making none.
 *
 *   2. **The slice folder's name**, matched against the declared domain names. Recorded as
 *      `resolution: 'folder'` - the same word `extractDomainRegistryRelations` writes for the
 *      identical fallback on a bounded context, because two edges answering "which domain" must not
 *      spell one source two ways. Nothing here resolves to a placeholder: a folder naming no
 *      declared domain is not a dangling reference, it is a folder. A folder name matching two
 *      declared domains produces no edge either, since an ambiguous default is not a default.
 *
 * A model that declares no `domains[]` registry has no name table, so every operation falls through
 * both sources and the extractor emits nothing - which is what every model in this repository does
 * today, and why this is additive.
 */
export function extractOperationDomainRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  /**
   * Declared domains keyed by folded name. A name is lower-cased and hyphens read as spaces,
   * because a folder is written `order-mgmt` where the registry writes `order mgmt`. A name
   * declared twice maps to null rather than to either domain.
   */
  const domainsByName = new Map<string, string | null>();
  const foldName = (value: string): string => value.toLowerCase().replace(/-/g, ' ').trim();
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Domain) continue;
    const name = (entity.data as Record<string, unknown> | undefined)?.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    const key = foldName(name);
    domainsByName.set(key, domainsByName.has(key) ? null : entity.id);
  }

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Operation) continue;
    const data = entity.data as Record<string, unknown> | undefined;
    const declared = data?.[DOMAIN_REF_DEFAULT];

    let targetId: string | undefined;
    let resolution: 'file-header' | 'folder';

    if (typeof declared === 'string' && declared.length > 0) {
      targetId = resolveOrPlaceholder(declared, entityDomain(entity), entities, placeholders);
      resolution = 'file-header';
    } else {
      const folder = entityDomain(entity);
      targetId = folder === 'default' ? undefined : (domainsByName.get(foldName(folder)) ?? undefined);
      resolution = 'folder';
    }

    if (!targetId) continue;
    relations.push({
      id: `${entity.id}--${RELATION_TYPE.OperationInDomain}--${targetId}`,
      source_entity_id: entity.id,
      target_entity_id: targetId,
      type: RELATION_TYPE.OperationInDomain,
      data: { resolution },
    });
  }

  return relations;
}
