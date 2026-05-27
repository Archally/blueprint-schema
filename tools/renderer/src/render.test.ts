import { describe, it, expect } from 'vitest';
import { renderBlueprint } from './render.js';
import { CMD1, EVT1, CMD2, CN1, SR1, TC1, CTX1, CTX2, ACT1, PRODUCES, REACTS_TO, INITIATED_BY, VALIDATES, CTX_REL, makeModel } from './test-fixtures.js';

const fullModel = makeModel(
  [CMD1, EVT1, CMD2, CN1, SR1, TC1, CTX1, CTX2, ACT1],
  [PRODUCES, REACTS_TO, INITIATED_BY, VALIDATES, CTX_REL],
);

describe('renderBlueprint', () => {
  it('produces a complete report with all sections', () => {
    const result = renderBlueprint(fullModel);
    expect(result).toContain('# Blueprint Report');
    expect(result).toContain('9 entities, 5 relations');
    expect(result).toContain('## Causal Chains');
    expect(result).toContain('## Entity Graph');
    expect(result).toContain('## Context Map');
    expect(result).toContain('## Entity Catalog');
    expect(result).toContain('## Relations');
    expect(result).toContain('## Coverage Gaps');
  });

  it('includes Archally Pro callouts after Mermaid diagrams', () => {
    const result = renderBlueprint(fullModel);
    expect(result).toContain('[Archally Pro](https://archally.pro)');
    expect(result).toContain('Interactive Causal Chain Explorer');
    expect(result).toContain('Interactive Entity Graph');
    expect(result).toContain('Interactive Context Map');
  });

  it('respects --no-mermaid option', () => {
    const result = renderBlueprint(fullModel, { includeMermaid: false });
    expect(result).not.toContain('```mermaid');
    expect(result).not.toContain('Archally Pro');
    expect(result).toContain('## Entity Catalog');
  });

  it('respects --no-relations option', () => {
    const result = renderBlueprint(fullModel, { includeRelations: false });
    expect(result).not.toContain('## Relations');
    expect(result).toContain('## Entity Catalog');
  });

  it('uses custom title when provided', () => {
    const result = renderBlueprint(fullModel, { title: 'My System' });
    expect(result).toContain('# My System');
  });

  it('falls back to project_id for title', () => {
    const model = makeModel([CN1], []);
    model.metadata.project_id = 'ecommerce';
    const result = renderBlueprint(model);
    expect(result).toContain('# ecommerce');
  });
});
