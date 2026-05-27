import type { Entity, Relation, BlueprintModel } from '../../model-builder/dist/model/types.js';

export function makeEntity(overrides: Partial<Entity> & { id: string; displayId: string }): Entity {
  return {
    type: 'Concept',
    layer: 'design.concepts',
    ...overrides,
  };
}

export function makeRelation(overrides: Partial<Relation> & { source_entity_id: string; target_entity_id: string; type: string }): Relation {
  return {
    id: `${overrides.source_entity_id}--${overrides.type}--${overrides.target_entity_id}`,
    ...overrides,
  };
}

export function makeModel(entities: Entity[], relations: Relation[]): BlueprintModel {
  return {
    entities,
    relations,
    metadata: {
      files: [],
      total_entities: entities.length,
      total_relations: relations.length,
      last_loaded: null,
    },
  };
}

export const CMD1 = makeEntity({ id: 'CMD001', displayId: 'CMD001', type: 'Command', layer: 'design.domain', summary: 'Place Order' });
export const EVT1 = makeEntity({ id: 'EVT001', displayId: 'EVT001', type: 'Event', layer: 'design.domain', summary: 'Order Placed' });
export const EVT2 = makeEntity({ id: 'EVT002', displayId: 'EVT002', type: 'Event', layer: 'design.domain', summary: 'Payment Failed' });
export const CMD2 = makeEntity({ id: 'CMD002', displayId: 'CMD002', type: 'Command', layer: 'design.domain', summary: 'Process Payment' });
export const QRY1 = makeEntity({ id: 'QRY001', displayId: 'QRY001', type: 'Query', layer: 'design.domain', summary: 'Get Order Status' });
export const CN1 = makeEntity({ id: 'CN001', displayId: 'CN001', type: 'Concept', layer: 'design.concepts', summary: 'Product' });
export const CN2 = makeEntity({ id: 'CN002', displayId: 'CN002', type: 'Concept', layer: 'design.concepts', summary: 'Category' });
export const SR1 = makeEntity({ id: 'SR001', displayId: 'SR001', type: 'Rule', layer: 'design.rules', summary: 'Order must have items' });
export const TC1 = makeEntity({ id: 'TC001', displayId: 'TC001', type: 'TestCase', layer: 'governance.test-cases', summary: 'Happy path order' });
export const ACT1 = makeEntity({ id: 'ACT001', displayId: 'ACT001', type: 'Actor', layer: 'design.concepts', summary: 'Customer' });
export const CTX1 = makeEntity({ id: 'CTX001', displayId: 'CTX001', type: 'Context', layer: 'design.arch', summary: 'Orders Context' });
export const CTX2 = makeEntity({ id: 'CTX002', displayId: 'CTX002', type: 'Context', layer: 'design.arch', summary: 'Payments Context' });

export const PRODUCES = makeRelation({ source_entity_id: 'CMD001', target_entity_id: 'EVT001', type: 'produces' });
export const REACTS_TO = makeRelation({ source_entity_id: 'CMD002', target_entity_id: 'EVT001', type: 'reacts_to' });
export const INITIATED_BY = makeRelation({ source_entity_id: 'CMD001', target_entity_id: 'ACT001', type: 'initiated_by' });
export const VALIDATES = makeRelation({ source_entity_id: 'TC001', target_entity_id: 'SR001', type: 'validates' });
export const CTX_REL = makeRelation({ source_entity_id: 'CTX001', target_entity_id: 'CTX002', type: 'depends_on' });
