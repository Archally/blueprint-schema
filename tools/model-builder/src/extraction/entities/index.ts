import type { Entity } from '../../model/types.js';
import type { ParsedBlueprintDocument, DocumentsBySchemaType } from '../../model/types.js';
import { getSchemaTypeFromPath } from './id.js';
import { extractConcepts } from './concepts.js';
import { extractRules } from './rules.js';
import { extractDomain } from './domain.js';
import { extractArch } from './arch.js';
import { extractMotivation } from './motivation.js';
import { extractDecisions } from './decisions.js';
import { extractTestCases } from './testCases.js';
import { extractStory } from './story.js';
import { extractOrg } from './org.js';
import { extractUI } from './ui.js';
import { extractModels } from './models.js';
import { extractCapability } from './capability.js';
import { extractQuality } from './quality.js';
import { extractRoadmap } from './roadmap.js';
import { extractValueStream } from './valueStream.js';
import { extractLeverage } from './leverage.js';
import { extractRg } from './rg.js';

/**
 * Optional extractors (stub: return [] until implemented).
 * dynamics
 */
function extractDynamics(_doc: ParsedBlueprintDocument): Entity[] {
  return [];
}

const EXTRACTORS: Record<string, (doc: ParsedBlueprintDocument) => Entity[]> = {
  concepts: extractConcepts,
  rules: extractRules,
  domain: extractDomain,
  arch: extractArch,
  motivation: extractMotivation,
  decisions: extractDecisions,
  'test-cases': extractTestCases,
  capability: extractCapability,
  quality: extractQuality,
  story: extractStory,
  dynamics: extractDynamics,
  models: extractModels,
  infrastructure: extractRg,
  organization: extractOrg,
  interactions: extractUI,
  roadmap: extractRoadmap,
  'value-stream': extractValueStream,
  leverage: extractLeverage,
};

/**
 * Extract all entities from documents pre-grouped by schema type.
 * All documents of the same schema type are processed together.
 */
export function extractAllEntities(documentsByType: DocumentsBySchemaType): Entity[] {
  const entities: Entity[] = [];
  for (const [schemaType, docs] of Object.entries(documentsByType)) {
    const extract = EXTRACTORS[schemaType];
    if (!extract) continue;
    for (const doc of docs) {
      entities.push(...extract(doc));
    }
  }
  return entities;
}

/**
 * Extract entities from a single document based on its schema type (from file path).
 * Convenience wrapper; prefer extractAllEntities for grouped processing.
 */
export function extractEntitiesFromDocument(doc: ParsedBlueprintDocument): Entity[] {
  const schemaType = getSchemaTypeFromPath(doc.filePath);
  if (!schemaType || schemaType === 'blueprint') return [];
  const extract = EXTRACTORS[schemaType];
  if (!extract) return [];
  return extract(doc);
}

export { extractConcepts } from './concepts.js';
export { extractRules } from './rules.js';
export { extractDomain } from './domain.js';
export { extractArch } from './arch.js';
export { extractMotivation } from './motivation.js';
export { extractDecisions } from './decisions.js';
export { extractTestCases } from './testCases.js';
export { extractStory } from './story.js';
export type { OperationDetail } from './story.js';
export { extractOrg } from './org.js';
export { extractUI } from './ui.js';
export { extractModels } from './models.js';
export { extractCapability } from './capability.js';
export { extractQuality } from './quality.js';
export { extractRoadmap } from './roadmap.js';
export { extractValueStream } from './valueStream.js';
export { extractLeverage } from './leverage.js';
export { extractRg } from './rg.js';
export { makeInternalId, getSchemaTypeFromPath } from './id.js';
