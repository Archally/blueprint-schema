import { describe, it, expect } from 'vitest';
import { buildRelations } from './index.js';
import { resolveRef, createPlaceholder, entityDomain } from './resolver.js';
import { buildBlueprintModel, groupDocumentsBySchemaType } from '../../model/buildModel.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

// ---------------------------------------------------------------------------
// resolver unit tests
// ---------------------------------------------------------------------------

describe('resolveRef', () => {
  it('returns existing entity id when displayId matches in same domain', () => {
    const entities = [
      { id: 'orders-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, layer: 'design.concepts', fileOrigin: 'orders/concepts.yaml' },
    ];
    expect(resolveRef('CN001', 'orders', entities)).toBe('orders-concepts.yaml-CN001');
  });

  it('returns null when no entity with matching displayId exists', () => {
    const entities = [
      { id: 'orders-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, layer: 'design.concepts', fileOrigin: 'orders/concepts.yaml' },
    ];
    expect(resolveRef('CN999', 'orders', entities)).toBeNull();
  });

  it('falls back to global match when not found in source domain', () => {
    const entities = [
      { id: 'catalog-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, layer: 'design.concepts', fileOrigin: 'catalog/concepts.yaml' },
    ];
    // Source domain is 'orders' but entity is in 'catalog' — should still resolve via fallback
    expect(resolveRef('CN001', 'orders', entities)).toBe('catalog-concepts.yaml-CN001');
  });

  it('prefers same-domain entity when multiple domains have matching displayId', () => {
    const entities = [
      { id: 'catalog-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, layer: 'design.concepts', fileOrigin: 'catalog/concepts.yaml' },
      { id: 'orders-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, layer: 'design.concepts', fileOrigin: 'orders/concepts.yaml' },
    ];
    expect(resolveRef('CN001', 'orders', entities)).toBe('orders-concepts.yaml-CN001');
  });

  it('handles scoped ref (billing.CN001) by targeting the specified domain', () => {
    const entities = [
      { id: 'billing-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, layer: 'design.concepts', fileOrigin: 'billing/concepts.yaml' },
      { id: 'orders-concepts.yaml-CN001', displayId: 'CN001', type: ENTITY_TYPE.Concept, layer: 'design.concepts', fileOrigin: 'orders/concepts.yaml' },
    ];
    expect(resolveRef('billing.CN001', 'orders', entities)).toBe('billing-concepts.yaml-CN001');
  });
});

describe('createPlaceholder', () => {
  it('creates a Missing entity with correct shape', () => {
    const p = createPlaceholder('CN999');
    expect(p.id).toBe('missing-CN999');
    expect(p.displayId).toBe('CN999');
    expect(p.type).toBe(ENTITY_TYPE.Missing);
    expect(p.layer).toBe('unknown');
    expect(p.data).toEqual({ unresolvedRef: 'CN999' });
  });

  it('sanitizes non-alphanumeric characters in ref for the id', () => {
    const p = createPlaceholder('billing.CN001');
    expect(p.id).toBe('missing-billing-CN001');
    expect(p.displayId).toBe('billing.CN001');
  });
});

describe('entityDomain', () => {
  it('returns first path segment as domain', () => {
    expect(entityDomain({ id: 'x', displayId: 'x', type: 'T', layer: 'l', fileOrigin: 'orders/concepts.yaml' })).toBe('orders');
  });

  it('returns "default" when fileOrigin has no path segments', () => {
    expect(entityDomain({ id: 'x', displayId: 'x', type: 'T', layer: 'l', fileOrigin: 'concepts.yaml' })).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// buildRelations integration tests
// ---------------------------------------------------------------------------

describe('buildRelations', () => {
  it('unresolved ref creates a Missing placeholder entity and a relation pointing to it', () => {
    const entities = [
      {
        id: 'orders-rules.yaml-SR001',
        displayId: 'SR001',
        type: ENTITY_TYPE.StructuralRule,
        layer: 'design.rules',
        fileOrigin: 'orders/rules.yaml',
        data: { id: 'SR001', name: 'Test rule', summary: 's', logic: { then: 'x' }, concepts: ['MISSING_REF'] },
      },
    ];
    const { relations, addedEntities } = buildRelations(entities, {});

    expect(addedEntities).toHaveLength(1);
    expect(addedEntities[0]!.type).toBe(ENTITY_TYPE.Missing);
    expect(addedEntities[0]!.displayId).toBe('MISSING_REF');

    expect(relations).toHaveLength(1);
    expect(relations[0]!.source_entity_id).toBe('orders-rules.yaml-SR001');
    expect(relations[0]!.target_entity_id).toBe('missing-MISSING-REF');
    expect(relations[0]!.type).toBe(RELATION_TYPE.Concepts);
  });

  it('resolved ref produces relation to existing entity without creating placeholder', () => {
    const entities = [
      {
        id: 'orders-concepts.yaml-CN001',
        displayId: 'CN001',
        type: ENTITY_TYPE.Concept,
        layer: 'design.concepts',
        fileOrigin: 'orders/concepts.yaml',
        data: { id: 'CN001', term: 'Order', summary: 's', definition: 'd' },
      },
      {
        id: 'orders-rules.yaml-SR001',
        displayId: 'SR001',
        type: ENTITY_TYPE.StructuralRule,
        layer: 'design.rules',
        fileOrigin: 'orders/rules.yaml',
        data: { id: 'SR001', name: 'Rule', summary: 's', logic: { then: 'x' }, concepts: ['CN001'] },
      },
    ];
    const { relations, addedEntities } = buildRelations(entities, {});

    expect(addedEntities).toHaveLength(0);
    expect(relations).toHaveLength(1);
    expect(relations[0]!.source_entity_id).toBe('orders-rules.yaml-SR001');
    expect(relations[0]!.target_entity_id).toBe('orders-concepts.yaml-CN001');
    expect(relations[0]!.type).toBe(RELATION_TYPE.Concepts);
  });

  it('multiple relations from one entity and different types extracted correctly', () => {
    const entities = [
      {
        id: 'orders-concepts.yaml-CN001',
        displayId: 'CN001',
        type: ENTITY_TYPE.Concept,
        layer: 'design.concepts',
        fileOrigin: 'orders/concepts.yaml',
        data: { id: 'CN001', term: 'Order', summary: 's', definition: 'd', transition_rules: ['TR001'] },
      },
      {
        id: 'orders-rules.yaml-TR001',
        displayId: 'TR001',
        type: ENTITY_TYPE.TransitionRule,
        layer: 'design.rules',
        fileOrigin: 'orders/rules.yaml',
        data: { id: 'TR001', name: 'Submit', summary: 's', concept: 'CN001', from: 'draft', to: 'submitted' },
      },
    ];
    const { relations, addedEntities } = buildRelations(entities, {});

    expect(addedEntities).toHaveLength(0);
    // CN001 → TR001 via transition_rules
    // TR001 → CN001 via concept
    expect(relations).toHaveLength(2);

    const trRelation = relations.find((r) => r.type === RELATION_TYPE.TransitionRules);
    const conceptRelation = relations.find((r) => r.type === RELATION_TYPE.Concept);
    expect(trRelation?.source_entity_id).toBe('orders-concepts.yaml-CN001');
    expect(trRelation?.target_entity_id).toBe('orders-rules.yaml-TR001');
    expect(conceptRelation?.source_entity_id).toBe('orders-rules.yaml-TR001');
    expect(conceptRelation?.target_entity_id).toBe('orders-concepts.yaml-CN001');
  });
});

// ---------------------------------------------------------------------------
// full model integration: one broken ref → Missing entity in model
// ---------------------------------------------------------------------------

describe('buildBlueprintModel with broken ref', () => {
  it('model includes Missing entity and relation for unresolvable ref', () => {
    const documents: ParsedBlueprintDocument[] = [
      {
        data: {
          version: '1.0.0',
          structural: [
            {
              id: 'SR001',
              name: 'Rule references missing concept',
              summary: 'test',
              logic: { then: 'true' },
              concepts: ['DOES_NOT_EXIST'],
            },
          ],
        },
        filePath: 'orders/rules.yaml',
        scope: 'orders',
      },
    ];

    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));

    const missing = model.entities.find((e) => e.type === ENTITY_TYPE.Missing);
    expect(missing).toBeDefined();
    expect(missing!.displayId).toBe('DOES_NOT_EXIST');

    expect(model.relations).toHaveLength(1);
    expect(model.relations[0]!.target_entity_id).toBe(missing!.id);
    expect(model.metadata.total_entities).toBe(model.entities.length);
    expect(model.metadata.total_relations).toBe(1);
  });
});
