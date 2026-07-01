import { describe, it, expect } from 'vitest';
import { extractArchContractRelations } from './archContracts.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'design.arch',
    fileOrigin: 'orders/orders.arch.yaml',
    ...overrides,
  };
}

const SUBMIT_ORDER = makeEntity({
  id: 'default-orders.domain.yaml-orders.CMD001',
  displayId: 'orders.CMD001',
  type: ENTITY_TYPE.Operation,
  layer: 'design.domain',
  fileOrigin: 'orders/orders.domain.yaml',
  data: { id: 'orders.CMD001', kind: 'command', name: 'Submit Order' },
});

const ORDER_PLACED = makeEntity({
  id: 'default-orders.domain.yaml-orders.EVT002',
  displayId: 'orders.EVT002',
  type: ENTITY_TYPE.Operation,
  layer: 'design.domain',
  fileOrigin: 'orders/orders.domain.yaml',
  data: { id: 'orders.EVT002', kind: 'event', name: 'Order Placed' },
});

describe('extractArchContractRelations', () => {
  it('maps expose/call/send/receive verbs to their relation types', () => {
    const contract = makeEntity({
      id: 'default-orders.arch.yaml-Store.OrderService.openapi',
      displayId: 'OrderService.openapi',
      type: ENTITY_TYPE.Contract,
      data: {
        _contractType: 'openapi',
        expose: ['orders.CMD001'],
        call: ['orders.CMD001'],
        send: ['orders.EVT002'],
        receive: ['orders.EVT002'],
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractArchContractRelations(
      [contract, SUBMIT_ORDER, ORDER_PLACED],
      placeholders
    );

    const byType = (t: string) => relations.filter((r) => r.type === t);
    expect(byType(RELATION_TYPE.ContractExposes)).toHaveLength(1);
    expect(byType(RELATION_TYPE.ContractCalls)).toHaveLength(1);
    expect(byType(RELATION_TYPE.ContractSends)).toHaveLength(1);
    expect(byType(RELATION_TYPE.ContractReceives)).toHaveLength(1);

    const expose = byType(RELATION_TYPE.ContractExposes)[0]!;
    expect(expose.source_entity_id).toBe(contract.id);
    expect(expose.target_entity_id).toBe(SUBMIT_ORDER.id);
    expect(placeholders.size).toBe(0);
  });

  it('creates a Missing placeholder for an unresolvable operation ref', () => {
    const contract = makeEntity({
      id: 'default-orders.arch.yaml-Store.OrderService.openapi',
      displayId: 'OrderService.openapi',
      type: ENTITY_TYPE.Contract,
      data: { _contractType: 'openapi', expose: ['orders.CMD999'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractArchContractRelations([contract, SUBMIT_ORDER], placeholders);

    expect(relations).toHaveLength(1);
    expect(placeholders.size).toBe(1);
    expect(relations[0]!.type).toBe(RELATION_TYPE.ContractExposes);
    expect(relations[0]!.target_entity_id).toBe([...placeholders.values()][0]!.id);
  });

  it('emits nothing for a contract with no operation-ref verbs', () => {
    const contract = makeEntity({
      id: 'default-orders.arch.yaml-Store.OrderService.openapi',
      displayId: 'OrderService.openapi',
      type: ENTITY_TYPE.Contract,
      data: { _contractType: 'openapi', output: 'gen/orders.ts' },
    });
    const relations = extractArchContractRelations([contract], new Map());
    expect(relations).toHaveLength(0);
  });

  it('ignores non-Contract entities', () => {
    const relations = extractArchContractRelations([SUBMIT_ORDER], new Map());
    expect(relations).toHaveLength(0);
  });
});
