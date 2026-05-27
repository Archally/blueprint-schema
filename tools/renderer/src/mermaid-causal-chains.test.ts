import { describe, it, expect } from 'vitest';
import { renderCausalChains } from './mermaid-causal-chains.js';
import { CMD1, CMD2, EVT1, EVT2, ACT1, CN1, PRODUCES, REACTS_TO, INITIATED_BY } from './test-fixtures.js';

describe('renderCausalChains', () => {
  it('renders command→event→reaction as a connected Mermaid graph', () => {
    const result = renderCausalChains(
      [CMD1, EVT1, CMD2, ACT1],
      [PRODUCES, REACTS_TO, INITIATED_BY],
    );
    expect(result).toContain('```mermaid');
    expect(result).toContain('CMD001');
    expect(result).toContain('EVT001');
    expect(result).toContain('CMD002');
    expect(result).toContain('-->|"produces"|');
    expect(result).toContain('-->|"reacts to"|');
    expect(result).toContain('-->|"initiated by"|');
  });

  it('uses entity summary as node label when available', () => {
    const result = renderCausalChains([CMD1, EVT1], [PRODUCES]);
    expect(result).toContain('"CMD001: Place Order"');
    expect(result).toContain('"EVT001: Order Placed"');
  });

  it('returns empty string when no causal relations exist', () => {
    const result = renderCausalChains([CN1], []);
    expect(result).toBe('');
  });

  it('only includes entities involved in causal relations', () => {
    const result = renderCausalChains(
      [CMD1, EVT1, CN1],
      [PRODUCES],
    );
    expect(result).toContain('CMD001');
    expect(result).not.toContain('CN001');
  });

  it('uses distinct Mermaid shapes for commands and events', () => {
    const result = renderCausalChains([CMD1, EVT1], [PRODUCES]);
    expect(result).toMatch(/CMD001\{\{/);
    expect(result).toMatch(/EVT001\(\[/);
  });
});
