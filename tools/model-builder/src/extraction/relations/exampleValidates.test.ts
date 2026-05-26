import { describe, it, expect } from 'vitest';
import { extractExampleValidatesRelations } from './exampleValidates.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

describe('extractExampleValidatesRelations', () => {
  it('creates example_validates relation from operation example test_ref', () => {
    const entities: Entity[] = [
      {
        id: 'orders-domain.yaml-CMD001',
        displayId: 'CMD001',
        type: ENTITY_TYPE.Operation,
        layer: 'design.domain',
        fileOrigin: 'orders/domain.yaml',
        data: {
          id: 'CMD001',
          kind: 'command',
          examples: [
            { name: 'valid-order', test_ref: 'TC001' },
            { name: 'no-test-ref' },
            { name: 'duplicate-order', test_ref: 'TC002' },
          ],
        },
      },
      {
        id: 'orders-test-cases.yaml-TC001',
        displayId: 'TC001',
        type: ENTITY_TYPE.TestCase,
        layer: 'governance.tests',
        fileOrigin: 'orders/test-cases.yaml',
      },
      {
        id: 'orders-test-cases.yaml-TC002',
        displayId: 'TC002',
        type: ENTITY_TYPE.TestCase,
        layer: 'governance.tests',
        fileOrigin: 'orders/test-cases.yaml',
      },
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractExampleValidatesRelations(entities, placeholders);

    expect(relations).toHaveLength(2);
    expect(relations.every((r) => r.type === RELATION_TYPE.ExampleValidates)).toBe(true);

    expect(relations[0]!.source_entity_id).toBe('orders-domain.yaml-CMD001');
    expect(relations[0]!.target_entity_id).toBe('orders-test-cases.yaml-TC001');
    expect((relations[0]!.data as Record<string, unknown>).example_name).toBe('valid-order');

    expect(relations[1]!.target_entity_id).toBe('orders-test-cases.yaml-TC002');
  });

  it('creates Missing placeholder for unresolvable test_ref', () => {
    const entities: Entity[] = [
      {
        id: 'orders-domain.yaml-CMD001',
        displayId: 'CMD001',
        type: ENTITY_TYPE.Operation,
        layer: 'design.domain',
        fileOrigin: 'orders/domain.yaml',
        data: {
          id: 'CMD001',
          kind: 'command',
          examples: [{ name: 'test', test_ref: 'TCMISSING' }],
        },
      },
    ];

    const placeholders = new Map<string, Entity>();
    const relations = extractExampleValidatesRelations(entities, placeholders);
    expect(relations).toHaveLength(1);
    expect(placeholders.size).toBe(1);
  });
});
