/**
 * Browser-compatible in-memory blueprint loader.
 *
 * Accepts a Map<virtualPath, yamlContent> and produces the same `LoadResult`-shaped
 * output as the Node.js backend loader (`viewer/v2/backend/src/blueprint/loader.ts`).
 * No Node.js built-in imports.
 *
 * Path conventions (forward slashes; Windows-style backslashes are normalized):
 *   "blueprint.yaml"                  → root metadata
 *   "{context}/domain.yaml"           → per-context layer files
 *   "{context}/{name}.domain.yaml"    → per-context multi-file naming convention
 *   "*.migration.yaml"                → migration files
 *
 * Files outside the blueprint convention (no schema match via getSchemaForFile)
 * are silently skipped.
 */

import type { ParsedBlueprintDocument, DocumentsBySchemaType } from './model/types.js';
import { groupDocumentsBySchemaType } from './model/buildModel.js';
import { getSchemaForFile } from './schemaTypes.js';
import { parseYAML } from './parseYaml.js';

export interface LoadFromMapResult {
  /** All parsed documents, one per recognized file (for metadata + file listing). */
  documents: ParsedBlueprintDocument[];
  /** Documents grouped by schema type — pass directly to `buildBlueprintModel`. */
  documentsByType: DocumentsBySchemaType;
  /** Parse errors encountered during loading (non-fatal). */
  errors: Array<{ path: string; message: string }>;
}

/**
 * Derive domain hint from relative path (first segment).
 * e.g. `"billing/concepts.yaml"` → `"billing"`.
 */
function domainHintFromPath(relativePath: string): string | undefined {
  const segments = relativePath.replace(/\\/g, '/').split('/');
  if (segments.length <= 1) return undefined;
  return segments[0] || undefined;
}

/**
 * Build a `LoadFromMapResult` from an in-memory file map.
 *
 * Keys are virtual paths relative to the blueprint root. The loader recognizes any file
 * whose name matches the v2 schema-type conventions (see `getSchemaForFile`). Other files
 * are ignored without warning.
 *
 * Parse errors are collected in `errors[]` and the offending file is skipped — loading
 * continues so the caller can render whatever is parseable.
 *
 * @param files In-memory file map (path → YAML content). Path keys may use either `/` or
 *              `\` separators; both are normalized to forward slashes internally.
 * @returns A LoadFromMapResult ready to feed into `buildBlueprintModel(documentsByType, …)`.
 */
export function loadFromMap(files: Map<string, string>): LoadFromMapResult {
  const documents: ParsedBlueprintDocument[] = [];
  const errors: Array<{ path: string; message: string }> = [];

  // Sort paths for deterministic load order (mirrors backend's listBlueprintFiles + sort).
  const normalizedEntries = [...files.entries()]
    .map(([path, content]) => [path.replace(/\\/g, '/'), content] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [relPath, content] of normalizedEntries) {
    const schemaType = getSchemaForFile(relPath);
    if (!schemaType) continue; // Unknown file — skip silently

    const parsed = parseYAML(content);
    if (parsed.error) {
      errors.push({ path: relPath, message: parsed.error.message });
      continue;
    }

    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const scope = domainHintFromPath(relPath);
    documents.push({
      data,
      filePath: relPath,
      scope,
    });
  }

  const documentsByType = groupDocumentsBySchemaType(documents);

  return { documents, documentsByType, errors };
}
