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

describe('extractTestCases: fitness functions', () => {
  const doc = (fitness: Record<string, unknown>[]): ParsedBlueprintDocument => ({
    data: {
      version: '1.0.0',
      happy_path: [{ id: 'TC001', name: 'Submit valid order' }],
      fitness_functions: fitness,
    },
    filePath: 'orders/test-cases.yaml',
    scope: 'orders',
  });

  it('is a FitnessFunction, not a TestCase', () => {
    // A test case exercises one scenario; a fitness function asserts a property of the graph.
    // Both collections are extracted as distinct entity types.
    const entities = extractTestCases(doc([
      { id: 'FF001', name: 'Every command produces events', assertion: 'command => produces.length > 0' },
    ]));
    const fitness = entities.filter((entity) => entity.type === ENTITY_TYPE.FitnessFunction);
    expect(fitness).toHaveLength(1);
    expect(fitness[0]!.displayId).toBe('FF001');
    expect(fitness[0]!.layer).toBe('governance.tests');
    expect(entities.filter((entity) => entity.type === ENTITY_TYPE.TestCase)).toHaveLength(1);
  });

  it('carries no suite, because it belongs to none', () => {
    const [fitness] = extractTestCases(doc([{ id: 'FF001', name: 'X', assertion: 'y' }]))
      .filter((entity) => entity.type === ENTITY_TYPE.FitnessFunction);
    expect(fitness!.data?.suite).toBeUndefined();
  });

  it('falls back to the assertion for its description, so it never renders as a bare name', () => {
    // `assertion` is required by the schema and `description` is not, so without the fallback a
    // fitness function reaches every reader with a name and nothing else.
    const [fitness] = extractTestCases(doc([
      { id: 'FF001', name: 'Every command produces events', assertion: 'command => produces.length > 0' },
    ])).filter((entity) => entity.type === ENTITY_TYPE.FitnessFunction);
    expect(fitness!.description).toBe('command => produces.length > 0');
  });

  it('prefers an authored description over the assertion', () => {
    const [fitness] = extractTestCases(doc([
      { id: 'FF001', name: 'X', assertion: 'a', description: 'why this guardrail exists' },
    ])).filter((entity) => entity.type === ENTITY_TYPE.FitnessFunction);
    expect(fitness!.description).toBe('why this guardrail exists');
  });

  it('skips an entry with no id rather than minting one', () => {
    // The valid sibling is asserted in the same breath, because "zero nameless entries" is also
    // true of an extractor that reads nothing at all, and those two outcomes must not look alike.
    const entities = extractTestCases(doc([
      { name: 'nameless', assertion: 'a' },
      { id: 'FF002', name: 'named', assertion: 'b' },
    ]));
    const fitness = entities.filter((entity) => entity.type === ENTITY_TYPE.FitnessFunction);
    expect(fitness.map((entity) => entity.displayId)).toEqual(['FF002']);
  });
});
