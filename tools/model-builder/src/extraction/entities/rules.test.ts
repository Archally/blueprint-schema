import { describe, it, expect } from 'vitest';
import { extractRules } from './rules.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractRules', () => {
  it('returns StructuralRule and TransitionRule for structural and transition arrays', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        structural: [
          { id: 'SR001', name: 'Order must have items', summary: 'An order requires at least one line', logic: { then: 'Order.items.count > 0' }, modality: 'necessary', concepts: ['CN001'] },
        ],
        transition: [
          { id: 'TR001', name: 'Submit order', summary: 'Order moves draft to submitted', concept: 'CN001', from: 'draft', to: 'submitted', guard: { when: 'validated' } },
        ],
      },
      filePath: 'orders/rules.yaml',
      scope: 'orders',
    };
    const entities = extractRules(doc);
    expect(entities).toHaveLength(2);
    const structural = entities.find((e) => e.type === ENTITY_TYPE.StructuralRule);
    const transition = entities.find((e) => e.type === ENTITY_TYPE.TransitionRule);
    expect(structural?.displayId).toBe('SR001');
    expect(transition?.displayId).toBe('TR001');
    expect(structural?.layer).toBe('design.rules');
    expect(transition?.layer).toBe('design.rules');
    expect(structural?.id).toBe('orders-rules.yaml-SR001');
    expect(transition?.id).toBe('orders-rules.yaml-TR001');
  });

  it('extracts rule without logic (v2.3 optional)', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        validation: [
          { id: 'VR001', name: 'Email must be valid' },
        ],
      },
      filePath: 'rules.yaml',
      scope: undefined,
    };
    const entities = extractRules(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.ValidationRule);
    expect(entities[0]!.term).toBe('Email must be valid');
  });

  it('reads description field from rule', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        structural: [
          { id: 'SR001', name: 'Positive total', description: 'Order total must be > 0' },
        ],
      },
      filePath: 'rules.yaml',
      scope: undefined,
    };
    const entities = extractRules(doc);
    expect(entities[0]!.description).toBe('Order total must be > 0');
  });
});
