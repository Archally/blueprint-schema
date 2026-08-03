import type {
  DocumentsBySchemaType,
  ParsedBlueprintDocument,
  RepositoryConfig,
} from './types.js';

/**
 * Model metadata extracted from parsed documents — domain descriptions and repository config.
 *
 * These are EXTRACTION, not assembly. `buildModel.ts` stays per-stack because each stack assembles
 * for a different surface (the monorepo for GraphQL/MCP, public for a CLI), but reading a
 * `repository:` block out of a blueprint root document is the same operation either way — and while
 * these functions lived inside the two `buildModel.ts` files they were maintained twice with nothing
 * to detect drift. They diverged exactly once, and silently: `repositories` (v2.7.1) existed in one
 * stack and not the other, so a multi-repo model produced a `code_ref` map on one side and nothing
 * on the other.
 *
 * Inside the unit they are hash-gated, so that class of divergence cannot recur.
 */

/** First path segment as the domain name; `default`, `.`, `..` and rootless paths are Global. */
function inferDomainFromPath(path: string | undefined): string {
  if (!path) return 'Global';
  const normalized = path.replace(/\\/g, '/');
  const seg = normalized.split('/').filter(Boolean)[0];
  if (!seg || seg === '.' || seg === '..') return 'Global';
  if (seg === 'default') return 'Global';
  return seg;
}

/**
 * Domain descriptions, keyed by domain and ordered by file path so the result is deterministic.
 * Several documents describing one domain are joined, blank-line separated.
 */
export function extractDomainDescriptions(
  documentsByType: DocumentsBySchemaType,
): Record<string, string> {
  const domainDocs = documentsByType.domain ?? [];
  if (domainDocs.length === 0) return {};

  const rows = domainDocs
    .map((doc) => {
      const raw = doc.data?.description;
      if (typeof raw !== 'string') return null;
      const description = raw.trim();
      if (!description) return null;
      return {
        path: doc.filePath ?? '',
        domain: inferDomainFromPath(doc.filePath),
        description,
      };
    })
    .filter((r): r is { path: string; domain: string; description: string } => r !== null)
    .sort((a, b) => a.path.localeCompare(b.path));

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    (grouped.get(row.domain) ?? grouped.set(row.domain, []).get(row.domain)!).push(row.description);
  }

  const out: Record<string, string> = {};
  for (const [domain, parts] of grouped) {
    out[domain] = parts.join('\n\n');
  }
  return out;
}

/**
 * Single repository config from blueprint root documents (v2.4). First one wins.
 *
 * Returns `undefined` rather than an empty object when absent: model metadata is hashed by
 * `fingerprintModel`, so emitting a present-but-empty key would change the digest of every model
 * that does not declare one.
 */
export function extractRepositoryConfig(
  blueprintDocs?: ParsedBlueprintDocument[],
): RepositoryConfig | undefined {
  if (!blueprintDocs) return undefined;
  for (const doc of blueprintDocs) {
    const repo = doc.data?.repository as Record<string, unknown> | undefined;
    if (!repo || typeof repo !== 'object') continue;
    const url = repo.url as string | undefined;
    if (!url) continue;
    return {
      url,
      branch: repo.branch != null ? String(repo.branch) : undefined,
      provider: repo.provider != null ? String(repo.provider) : undefined,
    };
  }
  return undefined;
}

/**
 * Multi-repository config map from blueprint root documents (v2.7.1), keyed by the `code_ref`
 * org/repo prefix. Entries without a `url` are skipped; `undefined` when absent or empty, for the
 * same fingerprint reason as {@link extractRepositoryConfig}.
 */
export function extractRepositoriesConfig(
  blueprintDocs?: ParsedBlueprintDocument[],
): Record<string, RepositoryConfig> | undefined {
  if (!blueprintDocs) return undefined;
  for (const doc of blueprintDocs) {
    const repos = doc.data?.repositories as Record<string, unknown> | undefined;
    if (!repos || typeof repos !== 'object') continue;
    const out: Record<string, RepositoryConfig> = {};
    for (const [key, value] of Object.entries(repos)) {
      const repo = value as Record<string, unknown> | undefined;
      const url = repo?.url as string | undefined;
      if (!url) continue;
      out[key] = {
        url,
        branch: repo!.branch != null ? String(repo!.branch) : undefined,
        provider: repo!.provider != null ? String(repo!.provider) : undefined,
      };
    }
    if (Object.keys(out).length > 0) return out;
  }
  return undefined;
}
