// GENERATED - do not edit.
// Emitted by tsc from the TypeScript module scope-runtime.ts, its single implementation.
// This plain-ESM copy is what the zero-build tools run. Editing this file makes it disagree with
// its source; change the TypeScript module and regenerate this copy.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeRepositoryUrl } from './code-root.mjs';
import { projectScope } from './scope-projection.mjs';
import { analyzeChangeScope } from './change-scope.mjs';
export function scopeOptions(positional, flags) {
    if (positional.length || flags.audit === true)
        throw new Error('--change-scope accepts a range, no positional paths or --audit');
    if (typeof flags.range !== 'string' || !flags.range.trim())
        throw new Error('--change-scope requires --range <base>..<head>');
    if (flags.format !== undefined && flags.format !== 'json' && flags.format !== 'markdown')
        throw new Error('--format must be markdown or json');
    if (flags.json === true && flags.format === 'markdown')
        throw new Error('--json conflicts with --format markdown');
    if (flags['code-root'] !== undefined && (typeof flags['code-root'] !== 'string' || !flags['code-root'].trim()))
        throw new Error('--code-root requires a directory');
    if (flags.suffix === false && flags['allow-suffix'] === true)
        throw new Error('--no-suffix conflicts with --allow-suffix');
    return { range: flags.range, format: flags.json === true || flags.format === 'json' ? 'json' : 'markdown', allowSuffix: flags['allow-suffix'] === true, strict: flags.strict === true };
}
/** Hooks must not redirect the repository being inspected. No git mutation is performed. */
function git(root, arguments_) {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    for (const name of Object.keys(env))
        if (name.startsWith('GIT_') && name !== 'GIT_OPTIONAL_LOCKS')
            delete env[name];
    return execFileSync('git', ['-C', root, ...arguments_], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, maxBuffer: 64 * 1024 * 1024 });
}
export function runChangeScope(input) {
    const modelDir = resolve(input.modelDir);
    if (!input.resolution.codeRoot)
        throw new Error(`No primary code root: ${input.resolution.notRunReason ?? 'pass --code-root <git checkout> or configure a repository mapping'}`);
    const root = git(input.resolution.codeRoot, ['rev-parse', '--show-toplevel']).trim();
    // The resolver's explicit root may be a subdirectory. Repository-root-relative refs require its top level.
    if (realpathSync(root) !== realpathSync(input.resolution.codeRoot))
        throw new Error('--code-root must be the git repository top level');
    const endpoints = /^([^\s]+)\.\.([^\s]+)$/.exec(input.options.range);
    if (!endpoints || input.options.range.includes('...'))
        throw new Error('--range must be <base>..<head> (endpoint tree difference)');
    const commit = (ref) => {
        try {
            return git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
        }
        catch {
            throw new Error(`Range endpoint is not a commit: ${ref}`);
        }
    };
    const base = commit(endpoints[1]);
    const head = commit(endpoints[2]);
    const tokens = git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', base, head, '--']).split('\0');
    const changes = [];
    for (let index = 0; index < tokens.length && tokens[index];) {
        const status = tokens[index++];
        const paths = /^[RC]/.test(status) ? [tokens[index++], tokens[index++]] : [tokens[index++]];
        if (paths.some(path => path === undefined))
            throw new Error('Malformed git name-status output');
        changes.push({ status, paths });
    }
    const documents = [];
    const modelFiles = [];
    const hash = createHash('sha256');
    const files = [];
    const walk = (directory) => {
        for (const entry of readdirSync(directory).sort()) {
            const full = join(directory, entry);
            const file = relative(modelDir, full).replace(/\\/g, '/');
            if (statSync(full).isDirectory()) {
                walk(full);
                continue;
            }
            if (!input.schemaForFile(file))
                continue;
            files.push(file);
        }
    };
    walk(modelDir);
    for (const file of files.sort()) {
        const bytes = readFileSync(join(modelDir, file));
        // Length-prefixed names and bytes avoid concatenation ambiguity, even for newline filenames.
        hash.update(`${Buffer.byteLength(file)}:`).update(file).update(`${bytes.length}:`).update(bytes);
        modelFiles.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
        try {
            const data = parseYaml(bytes.toString('utf8'));
            if (data && typeof data === 'object' && !Array.isArray(data))
                documents.push({ file, data });
        }
        catch (error) {
            throw new Error(`Cannot parse model file ${file}: ${error.message}`);
        }
    }
    const qualified = {};
    const primaryRow = input.resolution.repositoryRoots[0];
    const primaryUrls = new Set();
    const primaryUrl = primaryRow?.url ? normalizeRepositoryUrl(primaryRow.url) : null;
    if (primaryUrl)
        primaryUrls.add(primaryUrl);
    const remoteLines = git(root, ['remote', '-v']).split('\n');
    for (const line of remoteLines) {
        const url = line.split(/\s+/)[1];
        if (url) {
            const normalized = normalizeRepositoryUrl(url);
            if (normalized)
                primaryUrls.add(normalized);
        }
    }
    for (const row of input.resolution.repositoryRoots) {
        if (row.prefix === null)
            continue;
        const url = row.url ? normalizeRepositoryUrl(row.url) : null;
        qualified[row.prefix] = url ? (primaryUrls.has(url) ? 'primary' : 'different') : 'unknown';
    }
    const report = analyzeChangeScope({ projection: projectScope(documents), changes, repository: { primary: primaryUrl ?? [...primaryUrls].sort()[0] ?? null, qualified }, allowSuffix: input.options.allowSuffix });
    let dirtyModelFiles = [];
    let dirtyState = 'known';
    try {
        const modelRoot = git(modelDir, ['rev-parse', '--show-toplevel']).trim();
        // Limit status to the exact routed file set, including untracked model files.
        const statuses = git(modelRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...modelFiles.map(item => relative(modelRoot, join(modelDir, item.file)))]).split('\0');
        for (let index = 0; index < statuses.length && statuses[index]; index++) {
            const row = statuses[index];
            dirtyModelFiles.push(row.slice(3));
            if (/R|C/.test(row.slice(0, 2)))
                dirtyModelFiles.push(statuses[++index]);
        }
        dirtyModelFiles = dirtyModelFiles.sort();
    }
    catch {
        dirtyState = 'unavailable';
    }
    const result = { ...report, provenance: {
            tool: 'coverage-check/change-scope', version: '1.0.0',
            range: { requested: input.options.range, base, head, interpretation: 'endpoint-trees' },
            root: { path: root, source: input.resolution.codeRootSource, repositories: input.resolution.repositoryRoots, warnings: input.resolution.resolverWarnings },
            model: { directory: modelDir, snapshot: 'current-working-tree', hashAlgorithm: 'sha256-length-prefixed-path-and-bytes', hash: hash.digest('hex'), files: modelFiles, dirtyState, dirtyFiles: dirtyModelFiles },
        }, strictFailureReasons: input.options.strict ? [...new Set(report.gaps.map(gap => gap.kind))].sort() : [] };
    return { report: result, exitCode: input.options.strict && report.gaps.length ? 1 : 0 };
}
