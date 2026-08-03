/**
 * Blueprint v2 schema types — single source of truth for schema-type → filename mapping.
 *
 * Browser-safe (no Node.js imports). Used by:
 *   - viewer/v2/backend/src/blueprint/yamlService.ts (re-exported from here)
 *   - viewer/v2/core/src/loader-map.ts (browser loader)
 *   - any consumer of @blueprint-viewer/core/browser
 *
 * Adding a new schema type: extend V2_SCHEMA_TYPES, FILENAME_TO_SCHEMA, and MULTI_FILE_PATTERN.
 */

export const V2_SCHEMA_TYPES = [
  'migration',
  'concepts',
  'rules',
  'domain',
  'arch',
  'motivation',
  'decisions',
  'test-cases',
  'dynamics',
  'quality',
  'capability',
  'story',
  'models',
  'rg',
  'infrastructure',
  'org',
  'organization',
  'ui',
  'interactions',
  'roadmap',
  'value-stream',
  'leverage',
  'blueprint',
] as const;

export type V2SchemaType = (typeof V2_SCHEMA_TYPES)[number];

export const FILENAME_TO_SCHEMA: Record<string, V2SchemaType> = {
  'concepts.yaml': 'concepts',
  'concepts.yml': 'concepts',
  'rules.yaml': 'rules',
  'rules.yml': 'rules',
  'domain.yaml': 'domain',
  'domain.yml': 'domain',
  'arch.yaml': 'arch',
  'arch.yml': 'arch',
  'motivation.yaml': 'motivation',
  'motivation.yml': 'motivation',
  'decisions.yaml': 'decisions',
  'decisions.yml': 'decisions',
  'test-cases.yaml': 'test-cases',
  'test-cases.yml': 'test-cases',
  'dynamics.yaml': 'dynamics',
  'dynamics.yml': 'dynamics',
  'quality.yaml': 'quality',
  'quality.yml': 'quality',
  'capability.yaml': 'capability',
  'capability.yml': 'capability',
  'story.yaml': 'story',
  'story.yml': 'story',
  'models.yaml': 'models',
  'models.yml': 'models',
  'rg.yaml': 'rg',
  'rg.yml': 'rg',
  'infrastructure.yaml': 'infrastructure',
  'infrastructure.yml': 'infrastructure',
  'org.yaml': 'org',
  'org.yml': 'org',
  'organization.yaml': 'organization',
  'organization.yml': 'organization',
  'ui.yaml': 'ui',
  'ui.yml': 'ui',
  'interactions.yaml': 'interactions',
  'interactions.yml': 'interactions',
  'roadmap.yaml': 'roadmap',
  'roadmap.yml': 'roadmap',
  'value-stream.yaml': 'value-stream',
  'value-stream.yml': 'value-stream',
  'leverage.yaml': 'leverage',
  'leverage.yml': 'leverage',
  'blueprint.yaml': 'blueprint',
  'blueprint.yml': 'blueprint',
};

/** Multi-file pattern: {name}.{schema-type}.yaml (e.g. consumer.domain.yaml, payment.concepts.yaml). */
export const MULTI_FILE_PATTERN =
  /^[^/\\]+\.(concepts|rules|domain|arch|motivation|decisions|test-cases|dynamics|quality|capability|story|models|rg|infrastructure|org|organization|ui|interactions|roadmap|value-stream|leverage)\.(yaml|yml)$/i;

/**
 * Map file path to v2 schema type. Returns null for files outside the blueprint convention.
 *
 * Supports:
 *   - Exact filenames: `domain.yaml`, `concepts.yaml`, …
 *   - Multi-file pattern: `payment.domain.yaml`, `consumer.concepts.yaml`, `orders/story.yaml`
 *   - Migrations: `*.migration.yaml`
 */
export function getSchemaForFile(filePath: string): V2SchemaType | null {
  const segments = filePath.replace(/\\/g, '/').split('/');
  const fileName = segments[segments.length - 1] ?? '';
  if (/\.migration\.(yaml|yml)$/i.test(fileName)) return 'migration';
  const exact = FILENAME_TO_SCHEMA[fileName];
  if (exact) return exact;
  const multiMatch = fileName.match(MULTI_FILE_PATTERN);
  if (multiMatch) {
    const schemaType = multiMatch[1]!.toLowerCase();
    return (schemaType === 'test-cases' ? 'test-cases' : schemaType) as V2SchemaType;
  }
  return null;
}
