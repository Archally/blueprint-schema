import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['test-cases']!;

const SUITES: { key: string; suite: string }[] = [
  { key: 'happy_path', suite: 'happy_path' },
  { key: 'edge_cases', suite: 'edge_cases' },
  { key: 'error_cases', suite: 'error_cases' },
];

export function extractTestCases(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  // Fitness functions live in the same document as the test cases and are a different kind of
  // statement: a test case exercises one scenario, a fitness function asserts something about the
  // whole graph. They carry no `suite`, so they are collected separately rather than as a fourth
  // entry in SUITES.
  const fitnessFunctions = data.fitness_functions as Record<string, unknown>[] | undefined;
  if (Array.isArray(fitnessFunctions)) {
    for (const item of fitnessFunctions) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const name = item.name != null ? String(item.name) : undefined;
      // `assertion` is required by the schema and is the statement a reader signs off on, so it is
      // the description when no separate one is written. Without the fallback a fitness function
      // renders with a name and nothing else.
      const description = item.description != null
        ? String(item.description)
        : item.assertion != null
          ? String(item.assertion)
          : undefined;
      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, displayId),
        displayId,
        type: ENTITY_TYPE.FitnessFunction,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: name,
        term: name,
        description,
        data: item,
      });
    }
  }

  for (const { key, suite } of SUITES) {
    const arr = data[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const name = item.name != null ? String(item.name) : undefined;
      const summary = item.summary != null ? String(item.summary) : undefined;
      const description = item.description != null ? String(item.description) : undefined;
      entities.push({
        id,
        displayId,
        type: ENTITY_TYPE.TestCase,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: summary ?? name,
        term: name,
        description,
        data: { ...item, suite },
      });
    }
  }

  return entities;
}
