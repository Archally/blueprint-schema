import { describe, it, expect } from 'vitest';
import { extractQuality } from './quality.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractQuality', () => {
  it('extracts metrics with name and summary', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        metrics: [
          { id: 'MT001', name: 'Order Latency', summary: 'P99 latency', type: 'latency', unit: 'ms' },
        ],
      },
      filePath: 'quality.yaml',
      scope: undefined,
    };
    const entities = extractQuality(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Metric);
    expect(entities[0]!.layer).toBe('design.quality');
    expect(entities[0]!.term).toBe('Order Latency');
    expect(entities[0]!.summary).toBe('P99 latency');
  });

  it('extracts multiple quality entity types', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        metrics: [{ id: 'MT001', name: 'Latency', type: 'latency', unit: 'ms' }],
        kpis: [{ id: 'KPI001', name: 'Uptime', target: '99.9%' }],
        slos: [{ id: 'SLO001', name: 'API SLO', target: '99.5%' }],
        security: [{ id: 'SEC001', name: 'Auth Required', type: 'authentication', requirement: 'OAuth2' }],
      },
      filePath: 'quality.yaml',
      scope: undefined,
    };
    const entities = extractQuality(doc);
    expect(entities).toHaveLength(4);
    expect(entities.map((e) => e.type)).toEqual([
      ENTITY_TYPE.Metric,
      ENTITY_TYPE.KPI,
      ENTITY_TYPE.SLO,
      ENTITY_TYPE.Security,
    ]);
  });

  it('uses requirement as description fallback for security', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        security: [{ id: 'SEC001', name: 'Auth', type: 'authentication', requirement: 'Must use OAuth2' }],
      },
      filePath: 'quality.yaml',
      scope: undefined,
    };
    const entities = extractQuality(doc);
    expect(entities[0]!.description).toBe('Must use OAuth2');
  });

  it('extracts findings using title and statement fallbacks', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        findings: [
          {
            id: 'FN001',
            title: 'Checkout god-class',
            kind: 'god-class',
            severity: 'high',
            statement: 'OrderService mixes pricing, tax and shipping concerns.',
            risk_refs: ['R008'],
          },
        ],
      },
      filePath: 'checkout.findings.quality.yaml',
      scope: undefined,
    };
    const entities = extractQuality(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Finding);
    expect(entities[0]!.layer).toBe('design.quality');
    expect(entities[0]!.term).toBe('Checkout god-class');
    expect(entities[0]!.description).toBe('OrderService mixes pricing, tax and shipping concerns.');
    expect(entities[0]!.data).toMatchObject({ risk_refs: ['R008'] });
  });

  it('returns empty array for doc with no quality collections', () => {
    const doc: ParsedBlueprintDocument = {
      data: { version: '1.0.0' },
      filePath: 'quality.yaml',
      scope: undefined,
    };
    expect(extractQuality(doc)).toHaveLength(0);
  });
});
