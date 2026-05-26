import { describe, it, expect } from 'vitest';
import { extractCapability } from './capability.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractCapability', () => {
  it('extracts flat capabilities', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        capabilities: [
          { id: 'CAP001', name: 'Order Management', level: 1, description: 'Manages orders' },
          { id: 'CAP002', name: 'Payment Processing', level: 1 },
        ],
      },
      filePath: 'capability.yaml',
      scope: undefined,
    };
    const entities = extractCapability(doc);
    expect(entities).toHaveLength(2);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Capability);
    expect(entities[0]!.layer).toBe('governance.capability');
    expect(entities[0]!.term).toBe('Order Management');
    expect(entities[0]!.description).toBe('Manages orders');
    expect(entities[1]!.term).toBe('Payment Processing');
  });

  it('extracts nested capabilities recursively', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        capabilities: [
          {
            id: 'CAP001',
            name: 'Commerce',
            level: 1,
            children: [
              {
                id: 'CAP002',
                name: 'Order Capture',
                level: 2,
                children: [
                  { id: 'CAP003', name: 'Cart Management', level: 3 },
                ],
              },
              { id: 'CAP004', name: 'Fulfillment', level: 2 },
            ],
          },
        ],
      },
      filePath: 'capability.yaml',
      scope: undefined,
    };
    const entities = extractCapability(doc);
    expect(entities).toHaveLength(4);
    expect(entities.map((e) => e.displayId)).toEqual(['CAP001', 'CAP002', 'CAP003', 'CAP004']);
  });

  it('returns empty array for doc without capabilities', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0' },
      filePath: 'capability.yaml',
      scope: undefined,
    };
    expect(extractCapability(doc)).toHaveLength(0);
  });
});
