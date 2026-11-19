import { resolveCapabilityProducts } from '../../product-resolution.mjs';
import type { Entity, ParsedBlueprintDocument, DocumentsBySchemaType } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

export function extractProducts(doc: ParsedBlueprintDocument): Entity[] {
  const products = doc.data?.products;
  if (!Array.isArray(products)) {
    return [];
  }
  return products.filter(product => product && typeof product === 'object' && product.id != null).map(product => ({
    id: makeInternalId(doc.scope, doc.filePath, String(product.id)), displayId: String(product.id),
    type: ENTITY_TYPE.Product, layer: SCHEMA_TYPE_TO_LAYER.blueprint!, fileOrigin: doc.filePath,
    term: product.name, summary: product.name, description: product.description, data: product,
  }));
}

export function resolveProductEntities(entities: Entity[], documents: DocumentsBySchemaType) {
  const capabilities = entities.filter(entity => entity.type === 'Capability');
  const declaredProducts = entities.filter(entity => entity.type === 'Product');
  const roots = (documents.blueprint ?? []).filter(doc => Object.prototype.hasOwnProperty.call(doc.data, 'products'));
  const registry = roots.length ? roots.flatMap(doc => Array.isArray(doc.data.products) ? doc.data.products : [null]) : declaredProducts.length ? declaredProducts.map(entity => entity.data) : undefined;
  const records = capabilities.map(entity => ({ ...entity.data, id: entity.id, source: entity.fileOrigin, parentIds: [] as string[] }));
  for (const [index, entity] of capabilities.entries()) {
    const children = entity.data?.children;
    if (!Array.isArray(children)) {
      continue;
    }
    for (const child of children) {
      const matches = capabilities.filter(candidate => candidate.id === child?.id || (candidate.displayId === child?.id && candidate.fileOrigin === entity.fileOrigin));
      if (matches.length === 1) {
        records[capabilities.indexOf(matches[0])].parentIds.push(records[index].id);
      } else {
        // An ambiguous placement must not silently turn into an unassigned capability.
        for (const match of matches) {
          records[capabilities.indexOf(match)].parentIds.push(`unresolved-parent:${entity.id}`);
        }
      }
    }
  }
  return { result: resolveCapabilityProducts(records, registry), registry, capabilities, declaredProducts };
}

export function annotateProductResolution(entities: Entity[], documents: DocumentsBySchemaType): void {
  const { result, registry, capabilities } = resolveProductEntities(entities, documents);
  for (const entity of capabilities) {
    entity.data = { ...entity.data, _productResolution: result.resolutions.get(entity.id),
      ...(registry !== undefined ? { _productRegistry: registry } : {}) };
  }
}
