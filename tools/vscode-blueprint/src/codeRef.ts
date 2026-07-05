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

// ── local-clone resolution (step-02; D2 local-then-browser, D5 url-keyed + prefix alias) ──────────

export type CodeRefOpenBehavior = 'localThenBrowser' | 'browser' | 'local';

/**
 * Resolve a code_ref to a candidate ABSOLUTE local file path (a string — existence is NOT checked here; that
 * is I/O the caller does). The `localRoots` map is keyed by the resolved repo `url` (primary identity, D5) with
 * the `org/repo` prefix accepted as an alias; a trailing slash on the url key is tolerated. `localRoots` values
 * must already be absolute folders (the extension resolves any relative folder against the workspace first).
 * Returns `<root>/<filepath>` (forward-slash normalized), or `undefined` if no mapping applies.
 */
export function resolveLocalPath(
  rawPath: string,
  set: RepoConfigSet,
  localRoots: Record<string, string>,
): string | undefined {
  const { prefix, filepath } = parseCodeRefPath(rawPath);
  if (!filepath) return undefined;
  const url = selectRepoConfig(prefix, set)?.url;
  const root =
    (url && (localRoots[url] ?? localRoots[url.replace(/\/+$/, '')])) ||
    (prefix ? localRoots[prefix] : undefined);
  if (!root || !root.trim()) return undefined;
  const cleanRoot = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const cleanFile = filepath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${cleanRoot}/${cleanFile}`;
}

/**
 * Decide what a code_ref link opens (D2), given the `localRoots` map + `openBehavior`. The existence check is
 * INJECTED (`exists`) so this stays pure / `vscode`-free and the full behavior × existence matrix is unit-testable;
 * the extension supplies an fs-backed predicate. Semantics:
 *   - `localThenBrowser` → the local file when it exists, else the git-host URL;
 *   - `local`            → the local file when it exists, else nothing (no browser fallback);
 *   - `browser`          → always the git-host URL (local clone ignored).
 */
export async function resolveCodeRefTarget(
  rawPath: string,
  set: RepoConfigSet,
  localRoots: Record<string, string>,
  behavior: CodeRefOpenBehavior,
  exists: (absPath: string) => Promise<boolean>,
): Promise<{ kind: 'file'; value: string } | { kind: 'url'; value: string } | undefined> {
  if (behavior !== 'browser') {
    const candidate = resolveLocalPath(rawPath, set, localRoots);
    if (candidate && (await exists(candidate))) return { kind: 'file', value: candidate };
    if (behavior === 'local') return undefined; // no browser fallback
  }
  const url = resolveBrowserUrl(rawPath, set);
  return url ? { kind: 'url', value: url } : undefined;
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

// ── field/URL scanning (pure; the extension wraps each hit in a DocumentLink) ────────────────────

export interface CodeRefHit {
  line: number; // 0-based line index
  startCh: number; // 0-based start column of the value (quotes excluded)
  endCh: number; // exclusive end column
  raw: string; // the raw value text
}

/**
 * Find every `<valueKey>:` value inside a `<blockKey>:` block, with exact positions. Tracks the block by
 * indent so a matching key elsewhere is never picked up; handles block (`- key: X`) and inline-flow
 * (`{ key: X, ... }`) entries. Zero-dep line-scan (matches the rest of the extension) so ranges are exact
 * and it works before the model is built. `blockKey`/`valueKey` are plain identifiers (no regex metachars).
 */
export function scanFieldInBlock(text: string, blockKey: string, valueKey: string): CodeRefHit[] {
  const blockStartRe = new RegExp(`^(\\s*)${blockKey}:\\s*(?:#.*)?$`);
  const valueRe = new RegExp(`(?:^|[\\s{,])${valueKey}:\\s*(['"]?)([^'"\\n}]+?)\\1\\s*(?=[,}\\s]|$)`);
  const hits: CodeRefHit[] = [];
  const lines = text.split(/\r?\n/);
  let blockIndent: number | null = null; // indent of the active block, or null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startMatch = blockStartRe.exec(line);
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
    const valueMatch = valueRe.exec(line);
    if (!valueMatch) continue;
    const raw = valueMatch[2];
    const startCh = valueMatch.index + valueMatch[0].indexOf(raw);
    hits.push({ line: i, startCh, endCh: startCh + raw.length, raw });
  }
  return hits;
}

/** `code_refs[].path` values (repo-relative or cross-repo `org/repo#path`). */
export function scanCodeRefPaths(text: string): CodeRefHit[] {
  return scanFieldInBlock(text, 'code_refs', 'path');
}

/** `evidence[].source` values that are NOT http(s) URLs — file-path candidates (URLs are handled by scanUrls). */
export function scanEvidenceSources(text: string): CodeRefHit[] {
  return scanFieldInBlock(text, 'evidence', 'source').filter((h) => !/^https?:\/\//i.test(h.raw));
}

// Every http(s):// URL in a scalar value; the char class stops at a quote / whitespace / bracket, then
// trailing sentence punctuation is trimmed. Field-agnostic (E1) — VS Code does not linkify YAML-string URLs.
const URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}]+/g;

/** Every http(s):// URL anywhere in the document, with exact ranges. */
export function scanUrls(text: string): CodeRefHit[] {
  const hits: CodeRefHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(lines[i])) !== null) {
      const raw = m[0].replace(/[.,;:]+$/, ''); // trim trailing prose punctuation
      if (raw.length <= 'https://'.length) continue;
      hits.push({ line: i, startCh: m.index, endCh: m.index + raw.length, raw });
    }
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
