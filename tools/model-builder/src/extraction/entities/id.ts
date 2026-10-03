import { getSchemaForFile } from '../../schemaTypes.js';

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

/**
 * The schema type a file's name routes to, or null for a file outside the model.
 *
 * The answer is the builder's routing table, `getSchemaForFile`; this wrapper only accepts an
 * absent path, because an entity may carry none.
 */
export function getSchemaTypeFromPath(filePath: string | undefined): string | null {
  if (!filePath) return null;
  return getSchemaForFile(filePath);
}
