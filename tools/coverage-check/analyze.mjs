// GENERATED - do not edit.
// Emitted by tsc from the TypeScript module code-refs-coverage.ts, its single implementation.
// This plain-ESM copy is what the zero-build tools run. Editing this file makes it disagree with
// its source; change the TypeScript module and regenerate this copy.

/**
 * Pure `code_refs` coverage analysis - the SINGLE implementation behind `bp coverage-check` and the
 * zero-build `tools/coverage-check`. Deliberately import-free, so its compiled form is
 * self-contained ESM that the zero-build tool runs with no build step.
 *
 * Named `code-refs-coverage` rather than `code-coverage`: this is model↔source traceability, not
 * test coverage.
 *
 * ── What it answers ───────────────────────────────────────────────────────────────────────────
 * Two independent drift directions, which is the whole point - a tool that answers only the first
 * reports "all good" for a blueprint that has stopped describing the code:
 *
 *   1. code → model   Given paths that changed, which entities reference them? Paths with NO
 *                     referencing entity are `uncoveredPaths` - code changed without a blueprint
 *                     update, which is what a change review asks this for.
 *   2. model → code   Which `code_refs` point at files that no longer exist? Those are
 *                     `danglingRefs` - a blueprint describing code that has been moved or deleted.
 *
 * ── Cross-repo refs ───────────────────────────────────────────────────────────────────────────
 * A `code_ref.path` may be `org/repo#path/to/file` (metamodel `code_ref_entry`). With `refExists`
 * such a file cannot be checked, so it is reported `unverifiable` and never counted as dangling:
 * calling an unreachable file "missing" would make the whole report untrustworthy on first run.
 * With `checkRef` the caller decides per reference, prefix included: `present`, `missing`,
 * `unverifiable` with a reason (its repository has no local root), or `outside-root` with a reason
 * (absolute, or climbing out of its root; never probed).
 *
 * ── Matching ──────────────────────────────────────────────────────────────────────────────────
 * Segment-aligned, never raw substring: `src/a` must not match `src/abc/x`, which a bidirectional
 * `String.includes` would. Every match carries the reason it matched (`matchKind`) so a surprising
 * row can be audited rather than trusted.
 */
/** Remove a terminal #Lstart[-Lend] navigation location; coverage concerns the file. */
export function stripLineLocation(rawPath) {
    const path = rawPath.trim();
    const match = /#L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(path);
    if (!match)
        return rawPath;
    const line = Number(match[1]);
    const endLine = match[2] ? Number(match[2]) : undefined;
    if (!Number.isSafeInteger(line) || (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine < line)))
        return rawPath;
    return path.slice(0, match.index);
}
/** Split org/repo#path after removing a trailing line location. Same-repo paths get repo: null. */
export function splitRepoRef(rawPath) {
    const path = stripLineLocation(rawPath);
    const hash = path.indexOf('#');
    if (hash === -1)
        return { repo: null, path };
    return { repo: path.slice(0, hash), path: path.slice(hash + 1) };
}
/** Windows separators, `./` prefixes and trailing slashes are noise, not meaning. */
export function normalizePath(rawPath) {
    let path = stripLineLocation(rawPath).trim().replace(/\\/g, '/');
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
    const outsideRootRefs = [];
    const checkRef = input.checkRef;
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
            if (!checkRef && !input.refExists)
                continue;
            const audit = {
                entityId: entity.id,
                entityType: entity.type,
                refPath: ref.path,
                repo,
                role,
                status: 'present',
            };
            if (checkRef) {
                const verdict = checkRef(refPath, repo);
                audit.status = verdict.status;
                if (verdict.reason !== null && verdict.reason !== undefined)
                    audit.reason = verdict.reason;
                if (verdict.status === 'missing')
                    danglingRefs.push(audit);
                else if (verdict.status === 'unverifiable')
                    unverifiableRefs.push(audit);
                else if (verdict.status === 'outside-root')
                    outsideRootRefs.push(audit);
            }
            else if (repo !== null) {
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
        ...(checkRef ? { outsideRootRefs } : {}),
        danglingChecked: Boolean(checkRef || input.refExists),
        totals: {
            entities: input.entities.length,
            entitiesWithRefs,
            refs: refCount,
            queries: queries.length,
            coveredQueries: coveredQueries.size,
        },
    };
}
