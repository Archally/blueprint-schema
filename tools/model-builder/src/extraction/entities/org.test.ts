import { describe, it, expect } from 'vitest';
import { extractOrg } from './org.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

function makeDoc(data: Record<string, unknown>): ParsedBlueprintDocument {
  return { data, filePath: 'organization.yaml', scope: 'orders' };
}

describe('extractOrg', () => {
  it('extracts parties, departments, and teams from nested structure', () => {
    const doc = makeDoc({
      parties: [
        {
          id: 'PRT001',
          name: 'Acme Commerce',
          departments: [
            { id: 'DPT001', name: 'Engineering', teams: ['TM001', 'TM002'] },
            { id: 'DPT002', name: 'Product' },
          ],
          teams: [
            { id: 'TM001', name: 'Order Squad' },
            { id: 'TM002', name: 'Platform Team' },
            { id: 'TM003', name: 'Product Design' },
          ],
        },
      ],
    });

    const entities = extractOrg(doc);

    // 1 party + 2 departments + 3 teams = 6
    expect(entities).toHaveLength(6);

    const party = entities.find((e) => e.type === ENTITY_TYPE.Party);
    expect(party).toBeDefined();
    expect(party!.displayId).toBe('PRT001');
    expect(party!.term).toBe('Acme Commerce');

    const depts = entities.filter((e) => e.type === ENTITY_TYPE.Department);
    expect(depts).toHaveLength(2);
    expect(depts[0]!.displayId).toBe('DPT001');
    expect((depts[0]!.data as Record<string, unknown>)._party).toBe('PRT001');

    const teams = entities.filter((e) => e.type === ENTITY_TYPE.Team);
    expect(teams).toHaveLength(3);
    expect(teams[0]!.displayId).toBe('TM001');
    expect((teams[0]!.data as Record<string, unknown>)._party).toBe('PRT001');
  });

  it('returns empty array for missing parties', () => {
    expect(extractOrg(makeDoc({}))).toHaveLength(0);
  });

  it('skips parties without id', () => {
    const doc = makeDoc({
      parties: [{ name: 'No ID Party', teams: [{ id: 'TM001', name: 'Team' }] }],
    });
    expect(extractOrg(doc)).toHaveLength(0);
  });

  it('sets layer to governance.org', () => {
    const doc = makeDoc({
      parties: [{ id: 'PRT001', name: 'P', teams: [{ id: 'TM001', name: 'T' }] }],
    });
    const entities = extractOrg(doc);
    for (const e of entities) {
      expect(e.layer).toBe('governance.org');
    }
  });
});
