// GENERATED — do not edit.
// Emitted by tsc from servers/blueprint/cli/src/verbs/code-refs-coverage.ts and copied here by scripts/port-parity.mjs.
// The TypeScript module is the single implementation: the vertical CLIs (bp/bv/rl/cstd) and the
// blueprint MCP import it directly, while this plain-ESM emission is what the zero-build public
// tools run. Editing this file makes the two disagree; change the .ts and re-run:
//     npm run build --workspace=servers/blueprint/cli && npm run port-parity:port

/**
 * Pure `code_refs` coverage analysis — the SINGLE implementation behind `bp coverage-check` and the
 * zero-build public `tools/coverage-check`. Deliberately import-free so `tsc` emits self-contained
 * ESM that the public tool can run with no build step (plan D38, the "generated port"); the DERIVED
 * phase of `scripts/port-parity.mjs` copies the emission to
 * `schemas/blueprint/.shared/coverage-check/analyze.mjs`.
 *
 * Named `code-refs-coverage` rather than `code-coverage`: this is model↔source traceability, not
 * test coverage.
 *
 * ── What it answers ───────────────────────────────────────────────────────────────────────────
 * Two independent drift directions, which is the whole point — a tool that answers only the first
 * reports "all good" for a blueprint that has stopped describing the code:
 *
 *   1. code → model   Given paths that changed, which entities reference them? Paths with NO
 *                     referencing entity are `uncoveredPaths` — code changed without a blueprint
 *                     update, which is precisely what `/sdlc.execute` and `/sdlc.review` invoke
 *                     this for.
 *   2. model → code   Which `code_refs` point at files that no longer exist? Those are
 *                     `danglingRefs` — a blueprint describing code that has been moved or deleted.
 *
 * ── Cross-repo refs ───────────────────────────────────────────────────────────────────────────
 * A `code_ref.path` may be `org/repo#path/to/file` (metamodel `code_ref_entry`). Such a file cannot
 * be checked from this clone, so it is reported `unverifiable` and never counted as dangling.
 * Calling an unreachable file "missing" would make the whole report untrustworthy on first run.
 *
 * ── Matching ──────────────────────────────────────────────────────────────────────────────────
 * Segment-aligned, never raw substring. `src/a` must not match `src/abc/x` — the pre-2026-07-26
 * verb used bidirectional `String.includes` and did exactly that. Every match carries the reason
 * it matched (`matchKind`) so a surprising row can be audited rather than trusted.
 */
/** Split the metamodel's `org/repo#path` cross-repo form. Same-repo paths get `repo: null`. */
export function splitRepoRef(rawPath) {
    const hash = rawPath.indexOf('#');
    if (hash === -1)
        return { repo: null, path: rawPath };
    return { repo: rawPath.slice(0, hash), path: rawPath.slice(hash + 1) };
}
/** Windows separators, `./` prefixes and trailing slashes are noise, not meaning. */
export function normalizePath(rawPath) {
    let path = rawPath.trim().replace(/\\/g, '/');
    while (path.startsWith('./'))
        path = path.slice(2);
    while (path.endsWith('/') && path.length > 1)
        path = path.slice(0, -1);
    return path;
}
/**
 * How `query` and `ref` relate, or null if they are different code. Segment-aligned throughout:
 * every comparison is anchored on a `/` boundary, so no prefix of a path component can match.
 */
export function classifyMatch(query, ref, allowSuffixMatch = true) {
    if (query === ref)
        return 'exact';
    if (ref.startsWith(`${query}/`))
        return 'ref-under-query';
    if (query.startsWith(`${ref}/`))
        return 'query-under-ref';
    if (allowSuffixMatch && (ref.endsWith(`/${query}`) || query.endsWith(`/${ref}`)))
        return 'suffix';
    return null;
}
export function analyzeCoverage(input) {
    const allowSuffixMatch = input.allowSuffixMatch ?? true;
    const queries = input.paths.map(normalizePath).filter((path) => path.length > 0);
    const matches = [];
    const danglingRefs = [];
    const unverifiableRefs = [];
    const coveredQueries = new Set();
    let entitiesWithRefs = 0;
    let refCount = 0;
    for (const entity of input.entities) {
        const refs = Array.isArray(entity.refs) ? entity.refs : [];
        let counted = false;
        for (const ref of refs) {
            if (!ref || typeof ref.path !== 'string' || ref.path.trim() === '')
                continue;
            refCount++;
            if (!counted) {
                entitiesWithRefs++;
                counted = true;
            }
            const { repo, path } = splitRepoRef(ref.path);
            const refPath = normalizePath(path);
            const role = ref.role ?? 'unknown';
            for (const query of queries) {
                const kind = classifyMatch(query, refPath, allowSuffixMatch);
                if (kind === null)
                    continue;
                coveredQueries.add(query);
                matches.push({
                    queryPath: query,
                    entityId: entity.id,
                    entityType: entity.type,
                    refPath: ref.path,
                    repo,
                    role,
                    matchKind: kind,
                });
            }
            if (!input.refExists)
                continue;
            const audit = {
                entityId: entity.id,
                entityType: entity.type,
                refPath: ref.path,
                repo,
                role,
                status: 'present',
            };
            if (repo !== null) {
                audit.status = 'unverifiable';
                unverifiableRefs.push(audit);
            }
            else if (!input.refExists(refPath)) {
                audit.status = 'missing';
                danglingRefs.push(audit);
            }
        }
    }
    return {
        matches,
        uncoveredPaths: queries.filter((query) => !coveredQueries.has(query)),
        danglingRefs,
        unverifiableRefs,
        danglingChecked: Boolean(input.refExists),
        totals: {
            entities: input.entities.length,
            entitiesWithRefs,
            refs: refCount,
            queries: queries.length,
            coveredQueries: coveredQueries.size,
        },
    };
}
//# sourceMappingURL=code-refs-coverage.js.map