import { describe, it, expect } from 'vitest';
import { extractValueStream } from './valueStream.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractValueStream', () => {
  it('extracts value streams with stages preserved in data', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        value_streams: [
          {
            id: 'VS001',
            name: 'Shop & Buy',
            description: 'End-to-end shopping flow',
            trigger: 'Customer arrives at storefront',
            outcome: 'Customer receives purchased goods',
            goal_refs: ['GL001'],
            metrics: ['KPI001', 'KPI002'],
            primary_actors: ['ACT001'],
            stages: [
              { name: 'Discover', capabilities: ['CAP001', 'CAP002'] },
              { name: 'Checkout', capabilities: ['CAP003'], pain_points: ['Slow'] },
            ],
          },
          {
            id: 'VS002',
            name: 'Sell & Fulfill',
            stages: [{ name: 'Catalog', capabilities: ['CAP004'] }],
          },
        ],
      },
      filePath: 'value-stream.yaml',
      scope: undefined,
    };

    const entities = extractValueStream(doc);
    expect(entities).toHaveLength(2);

    const vs1 = entities[0]!;
    expect(vs1.type).toBe(ENTITY_TYPE.ValueStream);
    expect(vs1.displayId).toBe('VS001');
    expect(vs1.layer).toBe('governance.value-stream');
    expect(vs1.term).toBe('Shop & Buy');
    expect(vs1.description).toBe('End-to-end shopping flow');
    expect(vs1.data).toHaveProperty('stages');
    expect(vs1.data).toHaveProperty('goal_refs');
    expect(vs1.data).toHaveProperty('metrics');

    const vs2 = entities[1]!;
    expect(vs2.displayId).toBe('VS002');
    expect(vs2.term).toBe('Sell & Fulfill');
  });

  it('respects scope for id generation', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        scope: 'prestashop',
        value_streams: [
          { id: 'VS001', name: 'Test', stages: [{ name: 'S1', capabilities: ['CAP001'] }] },
        ],
      },
      filePath: 'value-stream.yaml',
      scope: 'prestashop',
    };

    const entities = extractValueStream(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toContain('prestashop');
  });

  it('returns empty array for doc without value_streams', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0' },
      filePath: 'value-stream.yaml',
      scope: undefined,
    };
    expect(extractValueStream(doc)).toHaveLength(0);
  });

  it('skips items without id', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        value_streams: [
          { name: 'No ID', stages: [{ name: 'S1', capabilities: [] }] },
          { id: 'VS001', name: 'Valid', stages: [{ name: 'S1', capabilities: [] }] },
        ],
      },
      filePath: 'value-stream.yaml',
      scope: undefined,
    };
    const entities = extractValueStream(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.displayId).toBe('VS001');
  });
});
