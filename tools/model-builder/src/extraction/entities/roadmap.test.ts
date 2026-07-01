import { describe, it, expect } from 'vitest';
import { extractRoadmap } from './roadmap.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractRoadmap', () => {
  it('extracts Milestone entities with correct type and layer', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        milestones: [
          { id: 'MS001', name: 'MVP', target_date: '2026-06-01', description: 'Minimum viable product' },
          { id: 'MS002', name: 'Beta', target_date: '2026-09-01' },
        ],
      },
      filePath: 'orders/roadmap.yaml',
      scope: 'orders',
    };
    const entities = extractRoadmap(doc);
    expect(entities).toHaveLength(2);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Milestone);
    expect(entities[0]!.layer).toBe('governance.roadmap');
    expect(entities[0]!.displayId).toBe('MS001');
    expect(entities[0]!.summary).toBe('MVP');
    expect(entities[0]!.term).toBe('MVP');
    expect(entities[0]!.description).toBe('Minimum viable product');
    expect(entities[1]!.displayId).toBe('MS002');
  });

  it('generates deterministic ID with scope', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0', milestones: [{ id: 'MS001', name: 'MVP', target_date: '2026-06-01' }] },
      filePath: 'orders/roadmap.yaml',
      scope: 'orders',
    };
    const entities = extractRoadmap(doc);
    expect(entities[0]!.id).toBe('orders-roadmap.yaml-MS001');
  });

  it('generates ID without scope using path domain', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0', milestones: [{ id: 'MS001', name: 'MVP', target_date: '2026-06-01' }] },
      filePath: 'roadmap.yaml',
    };
    const entities = extractRoadmap(doc);
    expect(entities[0]!.id).toBe('default-roadmap.yaml-MS001');
  });

  it('stores raw data on entity for relation resolvers', () => {
    const milestone = { id: 'MS001', name: 'MVP', target_date: '2026-06-01', dependencies: ['MS002'] };
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0', milestones: [milestone] },
      filePath: 'roadmap.yaml',
    };
    const entities = extractRoadmap(doc);
    expect(entities[0]!.data).toBe(milestone);
  });

  it('skips items without id', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0', milestones: [{ name: 'No ID' }, { id: 'MS001', name: 'Has ID', target_date: '2026-06-01' }] },
      filePath: 'roadmap.yaml',
    };
    const entities = extractRoadmap(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.displayId).toBe('MS001');
  });

  it('returns empty array when milestones is not an array', () => {
    expect(extractRoadmap({ data: {}, filePath: 'roadmap.yaml' })).toEqual([]);
    expect(extractRoadmap({ data: { milestones: null }, filePath: 'roadmap.yaml' })).toEqual([]);
  });

  it('extracts WorkItem entities recursively (epic → nested children, v2.7.2)', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        work_items: [
          {
            id: 'WI001', kind: 'epic', name: 'Survey Setup', description: 'MVP epic',
            children: [
              { id: 'WI002', kind: 'subscope', name: 'Reminders' },
              { id: 'WI003', kind: 'subscope', name: 'Schedule', children: [{ id: 'WI004', kind: 'task', name: 'Cron' }] },
            ],
          },
        ],
      },
      filePath: 'orders/roadmap.yaml',
      scope: 'orders',
    };
    const workItems = extractRoadmap(doc).filter((e) => e.type === ENTITY_TYPE.WorkItem);
    expect(workItems.map((e) => e.displayId)).toEqual(['WI001', 'WI002', 'WI003', 'WI004']);
    expect(workItems[0]!.layer).toBe('governance.roadmap');
    expect(workItems[0]!.id).toBe('orders-roadmap.yaml-WI001');
    expect(workItems[0]!.summary).toBe('Survey Setup');
    expect(workItems[0]!.description).toBe('MVP epic');
  });

  it('extracts milestones and work_items together and skips work items without id', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        milestones: [{ id: 'MS001', name: 'MVP', target_date: '2026-06-01' }],
        work_items: [{ kind: 'epic', name: 'no id' }, { id: 'WI001', kind: 'epic', name: 'E1' }],
      },
      filePath: 'roadmap.yaml',
    };
    const entities = extractRoadmap(doc);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.Milestone)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.WorkItem)).toHaveLength(1);
  });
});
