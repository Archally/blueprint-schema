// GENERATED - do not edit.
// Emitted by tsc from the TypeScript module code-root.ts, its single implementation.
// This plain-ESM copy is what the zero-build tools run. Editing this file makes it disagree with
// its source; change the TypeScript module and regenerate this copy.

/**
 * Where is a repository's code on this machine? The single decision behind every tool that checks a
 * blueprint's `code_refs` against disk. The module imports nothing, so it runs unchanged where there
 * is no build step; every file read, YAML parse and git call reaches it through the caller
 * (`CodeRootIo`, `MappingInput`).
 *
 * A model names its code by a remote address (`repository.url`, and one `url` per `repositories:`
 * prefix). It never names a directory, because a directory is true on one machine only. This module
 * turns each address into a local root, or into a reason why there is none.
 *
 * Rules, in order. The primary repository (`repository.url`, unprefixed refs):
 *   1. `--code-root <dir>`, when given.
 *   2. The model's own clone: a remote of the git repository holding the model directory names the
 *      same repository as the URL. The root is that repository's top level (a worktree's top level
 *      when the model sits in a worktree).
 *   3. The per-machine mapping file: `repositories:` maps a URL to a directory.
 *   4. The model declares no `repository.url`: the top level of the git repository holding it.
 *   5. None, with a reason naming the URL, every remote compared and the mapping file.
 * A `repositories:` prefix takes rules 2, 3 and 5; `--code-root` names one directory and is the
 * primary repository's only.
 *
 * URLs are compared as `host/path`: scp-like (`git@host:o/r.git`), `ssh://` (with a port) and
 * `https://` (with userinfo) spellings are equal; the host and the path are compared without case;
 * `.git` and a trailing `/` are dropped; a nested group path is kept whole. Output keeps the
 * spellings as written.
 *
 * The mapping file is read only, never created. Warnings, each naming the file and the entry:
 *   - the file named by the environment variable does not exist (the default path is then not read);
 *   - the file is not YAML, or has no `repositories:` map;
 *   - an entry is refused: its value is not a string, or not an absolute or `~/` path;
 *   - an entry's key is not a repository URL;
 *   - two keys name the same repository (the first one is used);
 *   - a used entry names a directory that does not exist (that repository then has no root);
 *   - a used entry names a directory that is not a git repository, or whose remotes all name
 *     another repository;
 *   - git is not available.
 *
 * A reference that is absolute or climbs out of its root with `..` is `outside-root`: it is never
 * probed, wherever the code is.
 */
// ── Locations ────────────────────────────────────────────────────────────────────────────────────
/** The environment variable naming the mapping file. It replaces the default path. */
export const REPOSITORIES_FILE_ENV = 'ARCHALLY_REPOSITORIES_FILE';
function separatorOf(path) {
    return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}
function trimTrailingSeparators(path) {
    let trimmed = path;
    while (trimmed.length > 1 && (trimmed.endsWith('/') || trimmed.endsWith('\\')) && !/^[A-Za-z]:[\\/]$/.test(trimmed)) {
        trimmed = trimmed.slice(0, -1);
    }
    return trimmed;
}
function joinUnder(base, relativePath) {
    const separator = separatorOf(base);
    const tail = relativePath.replace(/[\\/]+/g, separator).replace(/^[\\/]+/, '');
    const head = trimTrailingSeparators(base);
    return tail === '' ? head : `${head}${head.endsWith(separator) ? '' : separator}${tail}`;
}
/**
 * Which mapping file to read: the one the environment variable names, else
 * `<home>/.archally/repositories.yaml`. An empty variable counts as unset.
 */
export function mappingFileLocation(env, home) {
    const named = env[REPOSITORIES_FILE_ENV];
    if (typeof named === 'string' && named.trim() !== '')
        return { file: named, explicit: true };
    return { file: joinUnder(home, '.archally/repositories.yaml'), explicit: false };
}
// ── URL normalisation ────────────────────────────────────────────────────────────────────────────
/**
 * `host/path` for a repository URL, lowercased, or `null` when the text names no host (a local
 * path, an empty string). Accepts `scheme://[userinfo@]host[:port]/path` and scp-like
 * `[user@]host:path`.
 */
export function normalizeRepositoryUrl(raw) {
    const text = raw.trim();
    if (text === '')
        return null;
    let host;
    let path;
    const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(text);
    if (schemeMatch) {
        if (schemeMatch[1].toLowerCase() === 'file')
            return null;
        let authority = schemeMatch[2];
        const at = authority.lastIndexOf('@');
        if (at !== -1)
            authority = authority.slice(at + 1);
        host = authority.replace(/:\d*$/, '');
        path = schemeMatch[3] ?? '';
    }
    else {
        // scp-like: no scheme, a colon before the first slash, and not a drive letter.
        const scpMatch = /^(?:[^@/\\]+@)?([^:/\\]+):(.+)$/.exec(text);
        if (!scpMatch || /^[A-Za-z]$/.test(scpMatch[1]))
            return null;
        host = scpMatch[1];
        path = scpMatch[2];
    }
    host = host.toLowerCase();
    if (host === '')
        return null;
    path = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (path.toLowerCase().endsWith('.git'))
        path = path.slice(0, -4);
    path = path.replace(/\/+$/, '');
    if (path === '')
        return null;
    return `${host}/${path.toLowerCase()}`;
}
// ── Paths ────────────────────────────────────────────────────────────────────────────────────────
/** Absolute in any of the spellings a model may carry: POSIX, a drive letter, a UNC share. */
function isAbsoluteAnywhere(path) {
    return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path);
}
/**
 * Whether a `code_ref` path cannot be inside its root: it is absolute (POSIX, drive letter, UNC), or
 * its `..` segments climb above the root. Such a reference is never probed.
 */
export function isOutsideRoot(refPath) {
    const path = refPath.trim();
    if (isAbsoluteAnywhere(path))
        return true;
    let depth = 0;
    for (const segment of path.split(/[\\/]+/)) {
        if (segment === '' || segment === '.')
            continue;
        if (segment === '..') {
            depth -= 1;
            if (depth < 0)
                return true;
        }
        else {
            depth += 1;
        }
    }
    return false;
}
/** A mapping value as a directory, or `null` when it is neither absolute nor `~/`. */
function expandMappingValue(value, home) {
    const text = value.trim();
    if (text === '~')
        return trimTrailingSeparators(home);
    if (text.startsWith('~/') || text.startsWith('~\\'))
        return joinUnder(home, text.slice(2));
    if (isAbsoluteAnywhere(text))
        return trimTrailingSeparators(text);
    return null;
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readMapping(mapping, home, warnings) {
    const entries = new Map();
    if (!mapping)
        return { file: null, state: 'absent', entries };
    const { file } = mapping;
    if (mapping.state === 'absent') {
        if (mapping.explicit) {
            warnings.push(`${REPOSITORIES_FILE_ENV} names ${file}, which does not exist; no mapping was read`);
        }
        return { file, state: 'absent', entries };
    }
    if (mapping.state === 'unreadable') {
        warnings.push(`${file} could not be read as YAML (${mapping.error}); no mapping was used`);
        return { file, state: 'unusable', entries };
    }
    const data = mapping.data;
    if (data === null || data === undefined)
        return { file, state: 'usable', entries };
    if (!isPlainObject(data) || !isPlainObject(data.repositories)) {
        warnings.push(`${file} has no \`repositories:\` map of URL to directory; no mapping was used`);
        return { file, state: 'unusable', entries };
    }
    const repositories = data.repositories;
    for (const [key, value] of Object.entries(repositories)) {
        if (typeof value !== 'string') {
            warnings.push(`${file}: entry ${key} refused, its value is not a directory path`);
            continue;
        }
        const directory = expandMappingValue(value, home);
        if (directory === null) {
            warnings.push(`${file}: entry ${key} refused, ${value} is not an absolute or ~/ path`);
            continue;
        }
        const normalized = normalizeRepositoryUrl(key);
        if (normalized === null) {
            warnings.push(`${file}: entry ${key} refused, the key is not a repository URL`);
            continue;
        }
        const earlier = entries.get(normalized);
        if (earlier) {
            warnings.push(`${file}: entries ${earlier.key} and ${key} name the same repository; ${earlier.key} is used`);
            continue;
        }
        entries.set(normalized, { key, directory });
    }
    return { file, state: 'usable', entries };
}
function emptyRow(target) {
    return {
        prefix: target.prefix,
        url: target.url,
        root: null,
        source: 'none',
        reason: null,
        matchedRemote: null,
        mappingEntry: null,
        checkedOutBranch: null,
        headSha: null,
        declaredBranch: target.declaredBranch,
    };
}
function rowLabel(row) {
    return row.prefix === null ? (row.url ?? 'the primary repository') : `${row.prefix} (${row.url ?? 'no url'})`;
}
const ruleFlag = (target, context) => {
    const flag = context.input.codeRootFlag;
    if (target.prefix !== null || !flag)
        return null;
    return { ...emptyRow(target), root: flag, source: 'flag' };
};
const ruleOwnClone = (target, context) => {
    const info = context.holding.info;
    if (target.normalized === null || info === null)
        return null;
    const remote = info.remotes.find((candidate) => normalizeRepositoryUrl(candidate.url) === target.normalized);
    if (!remote)
        return null;
    return { ...emptyRow(target), root: info.topLevel, source: 'own-clone', matchedRemote: remote };
};
const ruleMapping = (target, context) => {
    if (target.normalized === null)
        return null;
    const entry = context.mapping.entries.get(target.normalized);
    if (!entry)
        return null;
    const file = context.mapping.file ?? 'the mapping file';
    if (!context.io.isDirectory(entry.directory)) {
        const reason = `the mapping entry ${entry.key} in ${file} names ${entry.directory}, which is not a directory`;
        context.warnings.push(`${file}: entry ${entry.key} names ${entry.directory}, which is not a directory`);
        return { ...emptyRow(target), reason, mappingEntry: entry.key };
    }
    const row = { ...emptyRow(target), root: entry.directory, source: 'mapping', mappingEntry: entry.key };
    let info = null;
    try {
        info = context.io.remotesOf(entry.directory);
    }
    catch {
        context.warnings.push(`${file}: entry ${entry.key}: git is not available, so the clone's remotes and branch were not read`);
        return row;
    }
    if (info === null) {
        context.warnings.push(`${file}: entry ${entry.key} names ${entry.directory}, which is not a git repository; its remotes and branch were not compared`);
        return row;
    }
    if (!info.remotes.some((remote) => normalizeRepositoryUrl(remote.url) === target.normalized)) {
        const compared = info.remotes.length === 0 ? 'it has no remotes' : `its remotes are ${describeRemotes(info.remotes)}`;
        context.warnings.push(`${file}: entry ${entry.key} names ${entry.directory}, but ${compared}`);
    }
    try {
        const head = context.io.headOf(entry.directory);
        row.checkedOutBranch = head?.branch ?? null;
        row.headSha = head?.shortSha ?? null;
    }
    catch {
        // The branch is reported when known; failing to read it changes no root.
    }
    return row;
};
const ruleHoldingRepository = (target, context) => {
    if (target.prefix !== null || target.url !== null || context.holding.info === null)
        return null;
    return {
        ...emptyRow(target),
        root: context.holding.info.topLevel,
        source: 'holding-repository',
        reason: 'the model declares no repository.url; checked against the repository holding the model',
    };
};
/** The rules in the order stated at the top of this module; the first that answers wins. */
const PRIMARY_RULES = [ruleFlag, ruleOwnClone, ruleMapping, ruleHoldingRepository];
const PREFIX_RULES = [ruleOwnClone, ruleMapping];
function describeRemotes(remotes) {
    return remotes.map((remote) => `${remote.name} ${remote.url}`).join(', ');
}
function noneReason(target, context) {
    const { holding, mapping } = context;
    if (target.url === null) {
        if (target.prefix !== null)
            return `${target.prefix} declares no url under repositories:`;
        if (holding.gitUnavailable)
            return 'the model declares no repository.url and git is not available, so the repository holding it is unknown; pass --code-root';
        return 'the model declares no repository.url and is not inside a git repository; pass --code-root';
    }
    if (target.normalized === null) {
        return `${target.url} is not a repository URL this tool can compare${target.prefix === null ? '; pass --code-root' : ''}`;
    }
    const parts = [`no local clone of ${target.url} was found`];
    if (holding.gitUnavailable) {
        parts.push('git is not available, so the repository holding the model was not read');
    }
    else if (holding.info === null) {
        parts.push('the model is not inside a git repository');
    }
    else if (holding.info.remotes.length === 0) {
        parts.push(`the repository holding the model (${holding.info.topLevel}) has no remotes`);
    }
    else {
        parts.push(`the repository holding the model (${holding.info.topLevel}) has remotes ${describeRemotes(holding.info.remotes)}, none of them this repository`);
    }
    if (mapping.file === null)
        parts.push('no mapping file was read');
    else if (mapping.state === 'absent')
        parts.push(`${mapping.file} does not exist`);
    else if (mapping.state === 'unusable')
        parts.push(`${mapping.file} could not be used`);
    else
        parts.push(`${mapping.file} has no entry for it`);
    const advice = target.prefix === null
        ? `add one under repositories: in ${mapping.file ?? 'the mapping file'}, or pass --code-root`
        : `add one under repositories: in ${mapping.file ?? 'the mapping file'}`;
    return `${parts.join('; ')}; ${advice}`;
}
function resolveTarget(target, rules, context) {
    for (const rule of rules) {
        const row = rule(target, context);
        if (row !== null)
            return row;
    }
    return { ...emptyRow(target), reason: noneReason(target, context) };
}
function stringOrNull(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}
function targetOf(prefix, declaration) {
    const url = stringOrNull(declaration?.url);
    return {
        prefix,
        url,
        normalized: url === null ? null : normalizeRepositoryUrl(url),
        declaredBranch: stringOrNull(declaration?.branch),
    };
}
function readHolding(input, io) {
    try {
        return { info: io.remotesOf(input.modelDir), gitUnavailable: false };
    }
    catch {
        return { info: null, gitUnavailable: true };
    }
}
/** Resolve the primary repository and every `repositories:` prefix to a local root, or a reason. */
export function resolveCodeRoots(input, io) {
    const warnings = [];
    const mapping = readMapping(input.mapping, input.home, warnings);
    const flagOnly = Boolean(input.codeRootFlag) && Object.keys(input.repositories ?? {}).length === 0;
    // With --code-root and no prefixes, nothing reads git: the flag answers every question asked.
    const holding = flagOnly ? { info: null, gitUnavailable: false } : readHolding(input, io);
    if (holding.gitUnavailable)
        warnings.push('git is not available; the repository holding the model was not read');
    const context = { input, io, holding, mapping, warnings };
    const rows = [resolveTarget(targetOf(null, input.repository), PRIMARY_RULES, context)];
    for (const [prefix, declaration] of Object.entries(input.repositories ?? {})) {
        rows.push(resolveTarget(targetOf(prefix, declaration), PREFIX_RULES, context));
    }
    const primary = rows[0];
    const anyResolved = rows.some((row) => row.root !== null);
    const named = rows.filter((row) => row.url !== null).map(rowLabel);
    const notRunReason = anyResolved
        ? null
        : `no local code root${named.length > 0 ? ` for ${named.join(', ')}` : ''}: ${primary.reason}`;
    return {
        codeRoot: primary.root,
        codeRootSource: primary.source,
        repositoryRoots: rows,
        resolverWarnings: warnings,
        notRunReason,
        mappingFile: mapping.file,
    };
}
// ── Using a resolution ───────────────────────────────────────────────────────────────────────────
/** The row a `code_ref` belongs to: the primary for an unprefixed ref, else its prefix's row. */
export function rootForRepository(resolution, repo) {
    const rows = resolution.repositoryRoots;
    if (repo === null)
        return rows[0] ?? null;
    return (rows.find((row) => row.prefix === repo) ??
        rows.find((row) => row.prefix !== null && row.prefix.toLowerCase() === repo.toLowerCase()) ??
        null);
}
/**
 * A `checkRef(path, repo)` over a resolution: `outside-root` without probing, `unverifiable` with
 * the reason when the reference's repository has no root, else `present` or `missing` by `exists`,
 * which receives the root and the path joined with `/`.
 */
export function createRefChecker(resolution, exists) {
    return (refPath, repo) => {
        if (isOutsideRoot(refPath)) {
            return { status: 'outside-root', reason: `${refPath} is absolute or leaves its repository's root, so it is not checked` };
        }
        const row = rootForRepository(resolution, repo);
        if (row === null) {
            return { status: 'unverifiable', reason: `${repo} is not declared under repositories:` };
        }
        if (row.root === null)
            return { status: 'unverifiable', reason: row.reason };
        const path = refPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
        return { status: exists(`${trimTrailingSeparators(row.root)}/${path}`) ? 'present' : 'missing', reason: null };
    };
}
const SOURCE_TEXT = {
    flag: 'given by --code-root',
    'own-clone': "the model's own clone",
};
/** One line for one repository: its root and where it came from, or why it has none. */
export function formatRepositoryRootLine(row, mappingFile = null) {
    const name = row.prefix === null ? 'code root' : `code root for ${row.prefix}`;
    if (row.root === null)
        return `${name}: none, ${row.reason}`;
    if (row.source === 'holding-repository')
        return `${name}: ${row.root} (${row.reason})`;
    let source = row.source === 'mapping' ? `mapped by ${row.mappingEntry} in ${mappingFile ?? 'the mapping file'}` : SOURCE_TEXT[row.source];
    if (row.source === 'own-clone' && row.matchedRemote)
        source += `, remote ${row.matchedRemote.name} is ${row.matchedRemote.url}`;
    if (row.source === 'mapping') {
        if (row.checkedOutBranch !== null || row.headSha !== null) {
            source += `, on ${row.checkedOutBranch ?? 'an unknown branch'} at ${row.headSha ?? 'an unknown commit'}`;
        }
        if (row.declaredBranch !== null && row.checkedOutBranch !== null && row.declaredBranch !== row.checkedOutBranch) {
            source += `; the model declares branch ${row.declaredBranch}`;
        }
    }
    return `${name}: ${row.root} (${source})`;
}
/** The printed line for the primary repository. */
export function formatCodeRootLine(resolution) {
    const primary = resolution.repositoryRoots[0];
    return primary ? formatRepositoryRootLine(primary, resolution.mappingFile) : 'code root: none';
}
