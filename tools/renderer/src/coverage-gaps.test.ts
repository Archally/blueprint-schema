import { describe, it, expect } from 'vitest';
import { renderCoverageGaps } from './coverage-gaps.js';
import { CMD1, CMD2, EVT1, EVT2, SR1, TC1, CN1, CN2, ACT1, PRODUCES, VALIDATES, makeRelation } from './test-fixtures.js';

describe('renderCoverageGaps', () => {
  it('detects orphan entities with no relations', () => {
    const result = renderCoverageGaps([CN1, CN2, CMD1, EVT1], [PRODUCES]);
    expect(result).toContain('Orphan Entities (2)');
    expect(result).toContain('CN001');
    expect(result).toContain('CN002');
    expect(result).not.toContain('CMD001');
  });

  it('detects commands that produce no events', () => {
    const unlinked = makeRelation({ source_entity_id: 'CMD001', target_entity_id: 'ACT001', type: 'initiated_by' });
    const result = renderCoverageGaps([CMD1, CMD2, EVT1, ACT1], [unlinked, PRODUCES]);
    // CMD2 has no produces relation
    expect(result).toContain('Commands Without Events');
    expect(result).toContain('CMD002');
    expect(result).not.toContain('CMD001');
  });

  it('detects events with no source command', () => {
    const result = renderCoverageGaps([CMD1, EVT1, EVT2], [PRODUCES]);
    // EVT2 is not produced by any command
    expect(result).toContain('Events Without Source Command');
    expect(result).toContain('EVT002');
    expect(result).not.toContain('EVT001');
  });

  it('detects untested rules', () => {
    const sr2 = { id: 'SR002', displayId: 'SR002', type: 'Rule', layer: 'design.rules', summary: 'Price must be positive' };
    const result = renderCoverageGaps([SR1, sr2, TC1], [VALIDATES]);
    // SR1 is validated by TC1, SR2 is not
    expect(result).toContain('Untested Rules (1)');
    expect(result).toContain('SR002');
    expect(result).not.toContain('SR001');
  });

  it('reports no gaps when model is fully connected', () => {
    const result = renderCoverageGaps([CMD1, EVT1], [PRODUCES]);
    expect(result).toContain('No coverage gaps found');
  });
});
