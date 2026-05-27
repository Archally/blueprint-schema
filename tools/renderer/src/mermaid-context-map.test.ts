import { describe, it, expect } from 'vitest';
import { renderContextMap } from './mermaid-context-map.js';
import { CTX1, CTX2, CN1, CTX_REL, makeEntity, makeRelation } from './test-fixtures.js';

describe('renderContextMap', () => {
  it('renders bounded contexts and their relationships', () => {
    const result = renderContextMap([CTX1, CTX2], [CTX_REL]);
    expect(result).toContain('```mermaid');
    expect(result).toContain('CTX001["Orders Context"]');
    expect(result).toContain('CTX002["Payments Context"]');
    expect(result).toContain('-->|"depends on"|');
  });

  it('returns empty string when no context entities exist', () => {
    const result = renderContextMap([CN1], []);
    expect(result).toBe('');
  });

  it('excludes non-context relations from the diagram', () => {
    const crossRelation = makeRelation({ source_entity_id: 'CTX001', target_entity_id: 'CN001', type: 'contains' });
    const result = renderContextMap([CTX1, CTX2, CN1], [CTX_REL, crossRelation]);
    expect(result).toContain('depends on');
    expect(result).not.toContain('contains');
  });
});
