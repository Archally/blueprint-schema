import { describe, it, expect } from 'vitest';
import { extractModels } from './models.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

function makeDoc(data: Record<string, unknown>): ParsedBlueprintDocument {
  return { data, filePath: 'models.yaml', scope: 'orders' };
}

describe('extractModels', () => {
  it('extracts model schemas with x-model-id as displayId', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          Order: {
            'x-model-id': 'MDL001',
            purpose: 'read-model',
            description: 'Order aggregate.',
          },
          OrderLine: {
            'x-model-id': 'MDL002',
            purpose: 'shared',
          },
        },
      },
    });

    const entities = extractModels(doc);
    expect(entities).toHaveLength(2);

    expect(entities[0]!.displayId).toBe('MDL001');
    expect(entities[0]!.term).toBe('Order');
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Models);
    expect(entities[0]!.summary).toBe('Order aggregate.');

    expect(entities[1]!.displayId).toBe('MDL002');
    expect(entities[1]!.term).toBe('OrderLine');
  });

  it('falls back to schema name when x-model-id is absent', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          OrderList: {
            purpose: 'read-model',
            description: 'Paginated list.',
          },
        },
      },
    });

    const entities = extractModels(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.displayId).toBe('OrderList');
    expect(entities[0]!.term).toBe('OrderList');
  });

  it('returns empty array for missing components', () => {
    expect(extractModels(makeDoc({}))).toHaveLength(0);
  });

  it('returns empty array for missing schemas', () => {
    expect(extractModels(makeDoc({ components: {} }))).toHaveLength(0);
  });

  it('stores _schemaName in data', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          Order: { 'x-model-id': 'MDL001' },
        },
      },
    });
    const entities = extractModels(doc);
    expect((entities[0]!.data as Record<string, unknown>)._schemaName).toBe('Order');
  });

  it('sets layer to design.models', () => {
    const doc = makeDoc({
      components: { schemas: { Order: { 'x-model-id': 'MDL001' } } },
    });
    const entities = extractModels(doc);
    expect(entities[0]!.layer).toBe('design.models');
  });

  it('stores _modelCategory as schema for components.schemas entries', () => {
    const doc = makeDoc({
      components: { schemas: { Order: { 'x-model-id': 'MDL001' } } },
    });
    const entities = extractModels(doc);
    expect((entities[0]!.data as Record<string, unknown>)._modelCategory).toBe('schema');
  });

  it('extracts x-field entries with _modelCategory x-field', () => {
    const doc = makeDoc({
      components: {
        'x-field': {
          OrderId: {
            type: 'string',
            format: 'uuid',
            description: 'Unique order identifier',
          },
          MoneyAmount: {
            type: 'number',
            format: 'double',
          },
        },
      },
    });

    const entities = extractModels(doc);
    expect(entities).toHaveLength(2);

    expect(entities[0]!.term).toBe('OrderId');
    expect(entities[0]!.displayId).toBe('OrderId');
    expect(entities[0]!.summary).toBe('Unique order identifier');
    expect((entities[0]!.data as Record<string, unknown>)._modelCategory).toBe('x-field');
    expect((entities[0]!.data as Record<string, unknown>)._schemaName).toBe('OrderId');

    expect(entities[1]!.term).toBe('MoneyAmount');
    expect((entities[1]!.data as Record<string, unknown>)._modelCategory).toBe('x-field');
  });

  it('extracts x-parameter entries with _modelCategory x-parameter', () => {
    const doc = makeDoc({
      components: {
        'x-parameter': {
          OrderIdPath: {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Order ID path parameter',
            schema: { type: 'string', format: 'uuid' },
          },
        },
      },
    });

    const entities = extractModels(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.term).toBe('OrderIdPath');
    expect(entities[0]!.summary).toBe('Order ID path parameter');
    expect((entities[0]!.data as Record<string, unknown>)._modelCategory).toBe('x-parameter');
  });

  it('extracts all three sections from a single document', () => {
    const doc = makeDoc({
      components: {
        schemas: {
          Order: { 'x-model-id': 'MDL001', purpose: 'read-model' },
        },
        'x-field': {
          OrderId: { type: 'string', format: 'uuid' },
        },
        'x-parameter': {
          OrderIdPath: { name: 'id', in: 'path' },
        },
      },
    });

    const entities = extractModels(doc);
    expect(entities).toHaveLength(3);

    const categories = entities.map(e => (e.data as Record<string, unknown>)._modelCategory);
    expect(categories).toEqual(['schema', 'x-field', 'x-parameter']);
  });
});
