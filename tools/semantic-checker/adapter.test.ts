import { describe, it, expect } from 'vitest';
import type { BlueprintModel } from '@archally/blueprint-schema/model';
import { toCheckableModel } from './adapter.js';

// TST093 — the adapter maps BlueprintModel → CheckableModel: term→name, plane from layer prefix,
// structure manifest, and the canonical relation renames.

function model(): BlueprintModel {
  return {
    entities: [
      { id: 'shop-domain-CN001', displayId: 'CN001', type: 'Concept', layer: 'design.domain', term: 'Order', fileOrigin: 'domain/order.yaml', data: { stereotype: 'aggregate-root' } },
      { id: 'shop-tests-TC001', displayId: 'TC001', type: 'TestCase', layer: 'governance.tests', term: 'Order is placed', data: {} },
      { id: 'shop-rules-SR001', displayId: 'SR001', type: 'StructuralRule', layer: 'design.rules', term: 'Order must have a customer', data: {} },
    ],
    relations: [
      { id: 'r1', source_entity_id: 'shop-tests-TC001', target_entity_id: 'shop-rules-SR001', type: 'validates' },
      { id: 'r2', source_entity_id: 'shop-domain-QN001', target_entity_id: 'shop-domain-OP001', type: 'question_answered_by' },
      { id: 'r3', source_entity_id: 'shop-domain-OP001', target_entity_id: 'shop-domain-OP002', type: 'produces' },
    ],
    metadata: { files: [], total_entities: 3, total_relations: 3, last_loaded: '2026-05-31T00:00:00Z' },
  };
}

describe('toCheckableModel (blueprint adapter)', () => {
  const checkable = toCheckableModel(model());

  it('declares the producing schema', () => {
    expect(checkable.schema).toBe('blueprint');
  });

  it('maps term→name, keeps displayId/layer/fileOrigin, derives plane from the layer prefix', () => {
    const concept = checkable.entities.find(e => e.id === 'shop-domain-CN001')!;
    expect(concept.name).toBe('Order');
    expect(concept.displayId).toBe('CN001');
    expect(concept.layer).toBe('design.domain');
    expect(concept.plane).toBe('design');
    expect(concept.fileOrigin).toBe('domain/order.yaml');
    expect(concept.slices).toEqual([]);
    expect(concept.data).toEqual({ stereotype: 'aggregate-root' });

    const test = checkable.entities.find(e => e.id === 'shop-tests-TC001')!;
    expect(test.plane).toBe('governance');
  });

  it('renames relations to the canonical epistemic vocabulary (direction preserved)', () => {
    const byId = new Map(checkable.relations.map(r => [r.id, r]));
    expect(byId.get('r1')).toMatchObject({ source: 'shop-tests-TC001', target: 'shop-rules-SR001', type: 'validated-by' });
    expect(byId.get('r2')).toMatchObject({ source: 'shop-domain-QN001', target: 'shop-domain-OP001', type: 'answered-by' });
    expect(byId.get('r3')!.type).toBe('produces');
  });

  it('declares the design/governance planes and their layers in the structure manifest', () => {
    expect(checkable.structure.planes.map(p => p.id).sort()).toEqual(['design', 'governance']);
    expect(checkable.structure.layers).toContainEqual({ id: 'design.domain', plane: 'design' });
    expect(checkable.structure.layers).toContainEqual({ id: 'governance.tests', plane: 'governance' });
    expect(checkable.structure.slices).toEqual([]);
  });
});
