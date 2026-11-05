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


describe('capability kind exposure', () => {
  it('retains scoped CAP identity, explicit kinds and omitted fields through all supported depths', () => {
    let tree: Record<string, unknown> = { id: 'shop.CAP011', name: 'Leaf', level: 3, kind: 'feature' };
    for (let position = 10; position >= 1; position--) {
      tree = { id: `shop.CAP${String(position).padStart(3, '0')}`, name: `Capability ${position}`,
        level: 1, ...(position === 1 ? { kind: 'capability' } : {}), children: [tree] };
    }
    const before = structuredClone(tree);
    const entities = extractCapability({ filePath: 'shop/capability.yaml', scope: 'shop', data: { capabilities: [tree] } });
    expect(entities).toHaveLength(11);
    expect(entities.every(entity => entity.type === ENTITY_TYPE.Capability)).toBe(true);
    expect(entities[0]!.data?.kind).toBe('capability');
    expect(Object.hasOwn(entities[1]!.data!, 'kind')).toBe(false);
    expect(entities[10]!.displayId).toBe('shop.CAP011');
    expect(entities[10]!.fileOrigin).toBe('shop/capability.yaml');
    expect(entities[10]!.data?.kind).toBe('feature');
    expect(JSON.parse(JSON.stringify(entities))[10].data.kind).toBe('feature');
    expect(tree).toEqual(before);
  });
});
