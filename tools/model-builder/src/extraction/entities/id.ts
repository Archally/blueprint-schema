/**
 * Deterministic internal id: {domain}-{file}-{displayId}
 * Domain from doc.scope or first path segment; file = basename of filePath.
 */
export function makeInternalId(
  scope: string | undefined,
  filePath: string | undefined,
  displayId: string
): string {
  const domain = scope ?? domainFromPath(filePath);
  const fileKey = filePath ? filePath.replace(/\\/g, '/').split('/').pop() ?? 'file' : 'file';
  return `${domain}-${fileKey}-${displayId}`;
}

function domainFromPath(filePath: string | undefined): string {
  if (!filePath) return 'default';
  const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 1 ? segments[0]! : 'default';
}

const FILENAME_TO_SCHEMA: Record<string, string> = {
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
  'infrastructure.yaml': 'infrastructure',
  'infrastructure.yml': 'infrastructure',
  'organization.yaml': 'organization',
  'organization.yml': 'organization',
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
const MULTI_FILE_PATTERN =
  /^[^/\\]+\.(concepts|rules|domain|arch|motivation|decisions|test-cases|dynamics|quality|capability|story|models|infrastructure|organization|interactions|roadmap|value-stream|leverage)\.(yaml|yml)$/i;

export function getSchemaTypeFromPath(filePath: string | undefined): string | null {
  if (!filePath) return null;
  const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  // Migration files: `*.migration.yaml` / `*.migration.yml`.
  // Keep this branch in lockstep with `getSchemaForFile` in `../../schemaTypes.ts`
  // (single source of truth; this duplication exists for layering reasons —
  // schemaTypes.ts can't import from this file because of the dependency direction).
  if (/\.migration\.(yaml|yml)$/i.test(fileName)) return 'migration';
  const exact = FILENAME_TO_SCHEMA[fileName];
  if (exact) return exact;
  const multiMatch = fileName.match(MULTI_FILE_PATTERN);
  if (multiMatch) {
    const schemaType = multiMatch[1]!.toLowerCase();
    return schemaType === 'test-cases' ? 'test-cases' : schemaType;
  }
  return null;
}
