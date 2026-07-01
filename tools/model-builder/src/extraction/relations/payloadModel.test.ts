import { describe, it, expect } from 'vitest';
import { extractPayloadModelRelations } from './payloadModel.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'design.domain',
    fileOrigin: 'orders/orders.domain.yaml',
    ...overrides,
  };
}

// A model with an x-model-id: displayId is the MDL id, the PascalCase key survives on term/_schemaName.
const ORDER_PAYLOAD = makeEntity({
  id: 'default-orders.models.yaml-orders.MDL001',
  displayId: 'orders.MDL001',
  type: ENTITY_TYPE.Models,
  layer: 'design.models',
  fileOrigin: 'orders/orders.models.yaml',
  term: 'OrderPayload',
  data: { 'x-model-id': 'orders.MDL001', _schemaName: 'OrderPayload', _modelCategory: 'schema' },
});

describe('extractPayloadModelRelations', () => {
  it('resolves a PascalCase components.schemas key via term', () => {
    const op = makeEntity({
      id: 'default-orders.domain.yaml-orders.CMD001',
      displayId: 'orders.CMD001',
      type: ENTITY_TYPE.Operation,
      data: { id: 'orders.CMD001', kind: 'command', payload: { schema: 'OrderPayload' } },
    });
    const placeholders = new Map<string, Entity>();
    const rels = extractPayloadModelRelations([op, ORDER_PAYLOAD], placeholders);
    expect(rels).toHaveLength(1);
    expect(rels[0]!.type).toBe(RELATION_TYPE.PayloadModel);
    expect(rels[0]!.source_entity_id).toBe(op.id);
    expect(rels[0]!.target_entity_id).toBe(ORDER_PAYLOAD.id);
    expect(placeholders.size).toBe(0);
  });

  it('resolves a typed MDL id via displayId', () => {
    const op = makeEntity({
      id: 'default-orders.domain.yaml-orders.CMD002',
      displayId: 'orders.CMD002',
      type: ENTITY_TYPE.Operation,
      data: { id: 'orders.CMD002', kind: 'command', payload: { schema: 'orders.MDL001' } },
    });
    const rels = extractPayloadModelRelations([op, ORDER_PAYLOAD], new Map());
    expect(rels).toHaveLength(1);
    expect(rels[0]!.target_entity_id).toBe(ORDER_PAYLOAD.id);
  });

  it('emits nothing for an operation with no payload', () => {
    const op = makeEntity({
      id: 'default-orders.domain.yaml-orders.EVT003',
      displayId: 'orders.EVT003',
      type: ENTITY_TYPE.Operation,
      data: { id: 'orders.EVT003', kind: 'event' },
    });
    expect(extractPayloadModelRelations([op, ORDER_PAYLOAD], new Map())).toHaveLength(0);
  });

  it('creates a Missing placeholder for an unresolvable payload model', () => {
    const op = makeEntity({
      id: 'default-orders.domain.yaml-orders.CMD004',
      displayId: 'orders.CMD004',
      type: ENTITY_TYPE.Operation,
      data: { id: 'orders.CMD004', kind: 'command', payload: { schema: 'GhostPayload' } },
    });
    const placeholders = new Map<string, Entity>();
    const rels = extractPayloadModelRelations([op, ORDER_PAYLOAD], placeholders);
    expect(rels).toHaveLength(1);
    expect(placeholders.size).toBe(1);
    expect(rels[0]!.target_entity_id).toBe([...placeholders.values()][0]!.id);
  });
});
