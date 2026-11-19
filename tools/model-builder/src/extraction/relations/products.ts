import type { Entity, Relation, DocumentsBySchemaType } from '../../model/types.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { resolveProductEntities } from '../entities/products.js';

/** Adapt exact graph handles to the neutral resolver. Raw products are never replaced. */
export function extractProductRelations(entities: Entity[], documents: DocumentsBySchemaType): Relation[] {
  const { result, capabilities, declaredProducts } = resolveProductEntities(entities, documents);
  const relations: Relation[] = [];
  for (const entity of capabilities) {
    const resolution = result.resolutions.get(entity.id)!;
    for (const product of resolution.products ?? []) {
      const targets = declaredProducts.filter(target => target.displayId === product);
      if (targets.length !== 1 || !['stated', 'inherited', 'unresolved'].includes(resolution.origin)) {
        continue;
      }
      const sources = resolution.from.map(handle => ({ handle, id: capabilities.find(candidate => candidate.id === handle)?.displayId ?? handle }));
      relations.push({ id: `${entity.id}--${RELATION_TYPE.CapabilityProduct}--${targets[0].id}`,
        type: RELATION_TYPE.CapabilityProduct, source_entity_id: entity.id, target_entity_id: targets[0].id,
        data: { origin: resolution.from.includes(entity.id) ? 'stated' : 'inherited',
          ...(resolution.origin === 'unresolved' ? { unresolved: resolution.unresolved } : {}),
          ...(resolution.from.includes(entity.id) ? {} : { from: sources[0]?.id, from_handle: sources[0]?.handle, sources }) } });
    }
  }
  return relations;
}
