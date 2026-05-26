import { describe, it, expect } from 'vitest';
import { extractTestCases } from './testCases.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

describe('extractTestCases', () => {
  it('returns TestCase with suite in data (happy_path)', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        happy_path: [
          { id: 'TC001', name: 'Submit valid order', summary: 'OK', validates: { rules: ['SR001'], operations: ['OP001'] } },
        ],
      },
      filePath: 'orders/test-cases.yaml',
      scope: 'orders',
    };
    const entities = extractTestCases(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.TestCase);
    expect(entities[0]!.layer).toBe('governance.tests');
    expect(entities[0]!.displayId).toBe('TC001');
    expect(entities[0]!.data?.suite).toBe('happy_path');
  });
});
