/**
 * Pure code_ref → git-host URL resolution for the Archally Blueprint Navigation extension.
 *
 * No `vscode` import — unit-testable with `node:test`. The extension host (extension.ts) supplies
 * the raw text (a `code_ref` path found in a `.blueprint` YAML + the owning `blueprint.yaml` text)
 * and turns the result into a `DocumentLink`.
 *
 * A `code_ref` path is repo-root-relative (`src/models/Order.ts`) or cross-repo
 * (`org/repo#src/models/Order.ts`). Repository config lives in the root `blueprint.yaml`:
 * `repository` (default/primary) + `repositories` (a map keyed by the `org/repo` prefix). The
 * provider decides the file-URL pattern (github/gitlab/bitbucket; `x-*` → github).
 */

export interface RepositoryConfig {
  url: string;
  branch?: string;
  provider?: string;
}

export interface RepoConfigSet {
  repository?: RepositoryConfig;
  repositories?: Record<string, RepositoryConfig>;
}

/** Split a code_ref path into an optional `org/repo` prefix (before the first `#`) and the file path. */
export function parseCodeRefPath(raw: string): { prefix: string | null; filepath: string } {
  const trimmed = raw.trim();
  const hash = trimmed.indexOf('#');
  if (hash > 0) {
    return { prefix: trimmed.slice(0, hash), filepath: trimmed.slice(hash + 1) };
  }
  return { prefix: null, filepath: trimmed };
}

/** Pick the repo config for a code_ref: prefixed → `repositories[prefix]`; unprefixed → `repository`. */
export function selectRepoConfig(prefix: string | null, set: RepoConfigSet): RepositoryConfig | undefined {
  if (prefix) return set.repositories?.[prefix];
  return set.repository;
}

/**
 * Build the git-host file URL per the provider rule (schema `repository_config.provider`):
 *   github    → {url}/blob/{branch}/{path}
 *   gitlab    → {url}/-/blob/{branch}/{path}
 *   bitbucket → {url}/src/{branch}/{path}
 *   x-* / unknown / omitted → github pattern
 * Pure — normalizes a trailing slash on `url`, backslashes + a leading slash on `path`, and
 * defaults `branch` to `main`.
 */
export function buildCodeRefUrl(config: RepositoryConfig, filepath: string): string {
  const base = config.url.replace(/\/+$/, '');
  const branch = (config.branch && config.branch.trim()) || 'main';
  const path = filepath.replace(/\\/g, '/').replace(/^\/+/, '');
  switch ((config.provider || 'github').toLowerCase()) {
    case 'gitlab':
      return `${base}/-/blob/${branch}/${path}`;
    case 'bitbucket':
      return `${base}/src/${branch}/${path}`;
    default:
      return `${base}/blob/${branch}/${path}`;
  }
}

/** Full browser resolution: raw code_ref path + repo-config set → URL, or `undefined` if unresolvable. */
export function resolveBrowserUrl(rawPath: string, set: RepoConfigSet): string | undefined {
  const { prefix, filepath } = parseCodeRefPath(rawPath);
  if (!filepath) return undefined;
  const config = selectRepoConfig(prefix, set);
  if (!config || !config.url) return undefined;
  return buildCodeRefUrl(config, filepath);
}

// ── blueprint.yaml repository-config parsing (zero-dep, indent-based) ────────────────────────────
// The extension deliberately avoids a YAML dependency (line-scan everywhere, for exact ranges and
// pre-model operation). `repository`/`repositories` are simple, flat, root-level blocks, so a
// focused indent parser is reliable — and it is exhaustively unit-tested in codeRef.test.ts.

const SCALAR_RE = /^\s*(url|branch|provider)\s*:\s*(['"]?)(.*?)\2\s*(?:#.*)?$/;

function leadingIndent(line: string): number {
  return line.match(/^\s*/)![0].length;
}

/** Parse a flat `{url,branch,provider}` block whose children are indented deeper than `parentIndent`. */
function parseConfigBlock(lines: string[], start: number, parentIndent: number): RepositoryConfig | undefined {
  const out: Partial<RepositoryConfig> = {};
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (leadingIndent(line) <= parentIndent) break;
    const match = SCALAR_RE.exec(line);
    if (match) out[match[1] as keyof RepositoryConfig] = match[3].trim();
  }
  return out.url ? (out as RepositoryConfig) : undefined;
}

/** Parse the `repositories:` map — each child key (`org/repo:`) owns a config block. */
function parseRepositoriesMap(lines: string[], start: number): Record<string, RepositoryConfig> {
  const map: Record<string, RepositoryConfig> = {};
  let keyIndent = -1;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = leadingIndent(line);
    if (keyIndent === -1) {
      if (indent === 0) break; // no children — next top-level key
      keyIndent = indent;
    }
    if (indent < keyIndent) break; // end of the repositories block
    if (indent === keyIndent) {
      const km = line.match(/^\s*(['"]?)([^'":#\n]+?)\1\s*:\s*(?:#.*)?$/);
      if (km) {
        const config = parseConfigBlock(lines, i + 1, keyIndent);
        if (config) map[km[2].trim()] = config;
      }
    }
  }
  return map;
}

// ── code_refs path scanning (pure; the extension wraps each hit in a DocumentLink) ──────────────

const CODE_REFS_START_RE = /^(\s*)code_refs:\s*(?:#.*)?$/;
// A `path:` value inside a code_ref entry — block (`- path: X`) or inline flow (`{ path: X, ... }`).
const CODE_REF_PATH_RE = /(?:^|[\s{,])path:\s*(['"]?)([^'"\n}]+?)\1\s*(?=[,}\s]|$)/;

export interface CodeRefHit {
  line: number; // 0-based line index
  startCh: number; // 0-based start column of the path value (quotes excluded)
  endCh: number; // exclusive end column
  raw: string; // the raw code_ref path text
}

/**
 * Find every `code_refs[].path` value in a YAML document, with exact positions. Tracks the
 * `code_refs:` block by indent so a `path:` key elsewhere is never matched; handles block
 * (`- path: X`) and inline-flow (`{ path: X, ... }`) entries. Zero-dep, line-scan (matches the
 * rest of the extension) so ranges are exact and it works before the model is built.
 */
export function scanCodeRefPaths(text: string): CodeRefHit[] {
  const hits: CodeRefHit[] = [];
  const lines = text.split(/\r?\n/);
  let blockIndent: number | null = null; // indent of the active code_refs: block, or null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startMatch = CODE_REFS_START_RE.exec(line);
    if (startMatch) {
      blockIndent = startMatch[1].length;
      continue;
    }
    if (blockIndent === null) continue;
    // A non-blank, non-comment line at or below the block indent ends the block.
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#') && leadingIndent(line) <= blockIndent) {
      blockIndent = null;
      continue;
    }
    const pathMatch = CODE_REF_PATH_RE.exec(line);
    if (!pathMatch) continue;
    const raw = pathMatch[2];
    const startCh = pathMatch.index + pathMatch[0].indexOf(raw);
    hits.push({ line: i, startCh, endCh: startCh + raw.length, raw });
  }
  return hits;
}

/** Extract `repository` + `repositories` from a `blueprint.yaml`'s text (top-level keys only). */
export function parseRepositoryConfig(text: string): RepoConfigSet {
  const lines = text.split(/\r?\n/);
  const set: RepoConfigSet = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^repository\s*:\s*(?:#.*)?$/.test(line)) {
      const config = parseConfigBlock(lines, i + 1, 0);
      if (config) set.repository = config;
    } else if (/^repositories\s*:\s*(?:#.*)?$/.test(line)) {
      const map = parseRepositoriesMap(lines, i + 1);
      if (Object.keys(map).length) set.repositories = map;
    }
  }
  return set;
}
