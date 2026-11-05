// GENERATED - do not edit.
// Emitted by tsc from the TypeScript module change-scope.ts, its single implementation.
// This plain-ESM copy is what the zero-build tools run. Editing this file makes it disagree with
// its source; change the TypeScript module and regenerate this copy.

import { classifyMatch, normalizePath, splitRepoRef } from './analyze.mjs';
/** Typed directions form a DAG. No hop returns from a module or capability to operations. */
const hops = [
    ['Operation', 'capability_operation', 'Capability', 'in'],
    ['Operation', 'validates', 'TestCase', 'in'],
    ['Operation', 'handled_by', 'Context', 'out'],
    ['Operation', 'operation_in_domain', 'Domain', 'out'],
    ['Context', 'context_realizes_domain', 'Domain', 'out'],
    ['Context', 'contains', 'Service', 'out'],
    ['Service', 'provides', 'Contract', 'out'],
    ['Context', 'capability_realized_in', 'Capability', 'in'],
    ['Domain', 'capability_realized_in', 'Capability', 'in'],
];
const ordered = (values) => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
export function analyzeChangeScope(input) {
    const changes = ordered(input.changes.map(change => ({ status: change.status, paths: [...change.paths] })));
    const paths = [...new Set(changes.flatMap(change => change.paths))].sort();
    const matches = [];
    const unknownRepositories = [];
    const gaps = [];
    for (const entity of input.projection.entities)
        for (const ref of Array.isArray(entity.data.code_refs) ? entity.data.code_refs : []) {
            if (typeof ref?.path !== 'string' || !ref.path.trim())
                continue;
            const { repo, path } = splitRepoRef(ref.path);
            if (repo !== null && input.repository.qualified[repo] !== 'primary') {
                if (input.repository.qualified[repo] !== 'different')
                    unknownRepositories.push({ entity: entity.identity, refPath: ref.path, repo, reason: 'Repository identity cannot be proved to be the primary repository.' });
                continue;
            }
            const normalized = normalizePath(path);
            if (!normalized || /^(?:\/|[A-Za-z]:)|(?:^|\/)\.\.(?:\/|$)/.test(normalized)) {
                if (paths.length)
                    gaps.push({ kind: 'outside-root', entity: entity.identity, path: ref.path, reason: 'Reference is absolute or leaves its repository root.' });
                continue;
            }
            for (const queryPath of paths) {
                const matchKind = classifyMatch(normalizePath(queryPath), normalized, input.allowSuffix);
                if (matchKind)
                    matches.push({ queryPath, refPath: ref.path, repo, role: ref.role ?? 'unknown', matchKind, entity });
            }
        }
    ordered(matches);
    const unmatchedPaths = paths.filter(path => !matches.some(match => match.queryPath === path));
    for (const path of unmatchedPaths)
        gaps.push({ kind: 'unmatched-path', path, reason: 'No current model code_ref matches this changed path.' });
    const entities = new Map(input.projection.entities.map(entity => [entity.identity, entity]));
    const candidates = new Map();
    matches.forEach((match, matchIndex) => {
        if (!match.entity.canonicalHandle)
            gaps.push({ kind: 'graph-unavailable', entity: match.entity.identity, reason: 'Raw YAML match has no canonical graph entity in the scope projection.' });
        const visit = (entity, evidence) => {
            const category = entity.type === 'Capability' ? (evidence.some(edge => edge.type === 'capability_realized_in') ? 'contextual-capability' : 'capability')
                : entity.type === 'TestCase' ? 'test' : entity.type.toLowerCase();
            const key = `${category}:${entity.identity}`;
            const candidate = candidates.get(key) ?? { category, entity, evidence: [] };
            candidate.evidence.push({ match: matchIndex, edges: evidence });
            candidates.set(key, candidate);
            for (const [sourceType, relation, targetType, direction] of hops) {
                if (entity.type !== sourceType)
                    continue;
                for (const edge of input.projection.edges) {
                    if (edge.type !== relation || (direction === 'out' ? edge.source : edge.target) !== entity.identity)
                        continue;
                    const target = entities.get(direction === 'out' ? edge.target : edge.source);
                    if (target?.type === targetType)
                        visit(target, [...evidence, edge]);
                }
            }
        };
        visit(match.entity, []);
    });
    const candidateList = ordered([...candidates.values()].map(candidate => ({ ...candidate, evidence: ordered(candidate.evidence) })));
    const units = new Map();
    for (const entity of new Map(matches.map(match => [match.entity.identity, match.entity])).values()) {
        if (entity.type === 'InfraResource') {
            const unit = entity.data.deployment_unit;
            if (typeof unit?.unit_id !== 'string' || !unit.unit_id.trim()) {
                gaps.push({ kind: 'missing-deployment-unit', entity: entity.identity, reason: 'Directly matched infrastructure resource has no nonempty deployment_unit.unit_id.' });
            }
            else {
                const group = units.get(unit.unit_id) ?? { unitId: unit.unit_id, exportedOutputs: [], resources: [] };
                group.resources.push(entity.identity);
                group.exportedOutputs = [...new Set([...group.exportedOutputs, ...(Array.isArray(unit.exported_outputs) ? unit.exported_outputs.filter((item) => typeof item === 'string') : [])])].sort();
                units.set(unit.unit_id, group);
            }
        }
        else {
            gaps.push({ kind: 'deployment-unknown', entity: entity.identity, reason: 'No explicit resource placement is established by the allowed scope relationships; build/deploy scope is unknown.' });
        }
        if (entity.type === 'Operation') {
            if (!candidateList.some(candidate => candidate.category === 'capability' && candidate.evidence.some(path => matches[path.match]?.entity.identity === entity.identity)))
                gaps.push({ kind: 'missing-capability', entity: entity.identity, reason: 'No incoming effective capability_operation evidence.' });
            if (!candidateList.some(candidate => candidate.category === 'test' && candidate.evidence.some(path => matches[path.match]?.entity.identity === entity.identity)))
                gaps.push({ kind: 'missing-test', entity: entity.identity, reason: 'No incoming TestCase validates this operation.' });
        }
    }
    const automatedTests = ordered(candidateList.filter(candidate => candidate.category === 'test').flatMap(candidate => {
        const refs = Array.isArray(candidate.entity.data.code_refs) ? candidate.entity.data.code_refs : [];
        const testRefs = refs.filter((ref) => ref?.role === 'test' && typeof ref.path === 'string' && ref.path.trim());
        if (!testRefs.length)
            gaps.push({ kind: 'no-automated-test-evidence', entity: candidate.entity.identity, reason: 'Modeled test has no code_ref with role test; no executable file or command inferred.' });
        return testRefs.map((ref) => ({ test: candidate.entity.identity, path: ref.path, evidence: candidate.evidence }));
    }));
    // An empty tree diff has no scope to assess. Model-level unknowns remain informational.
    if (paths.length) {
        for (const item of unknownRepositories)
            gaps.push({ kind: 'unknown-repository', entity: item.entity, path: item.refPath, reason: item.reason });
        for (const item of input.projection.unresolved)
            gaps.push({ kind: 'unresolved-identity', entity: item.source, reason: `${item.reason}: ${item.ref}` });
    }
    return {
        reportVersion: '1.0.0',
        semantics: 'Endpoint tree difference against the current working-tree model; evidence-backed candidates, not complete release/build/test scope.',
        allowSuffix: input.allowSuffix,
        repository: input.repository,
        changes, matches, candidates: candidateList, automatedTests,
        deploymentUnits: ordered([...units.values()].map(unit => ({ ...unit, resources: unit.resources.sort() }))),
        unmatchedPaths, unknownRepositories: ordered(unknownRepositories), unresolvedIdentities: input.projection.unresolved,
        gaps: ordered(gaps),
        counts: { changedPaths: paths.length, matches: matches.length, candidates: candidateList.length, deploymentUnits: units.size, automatedTests: automatedTests.length },
        warnings: ['Current model attribution cannot reconstruct removed entities or historical ownership.', 'Context-derived services are contextual candidates, not proven operation providers.', 'Modeled tests and test files are candidates; no test command or passed execution is inferred.'],
    };
}
export function formatChangeScope(report) {
    const lines = ['# Evidenced change scope', '', report.semantics, '',
        `Changed paths: ${report.counts.changedPaths}; direct matches: ${report.counts.matches}; candidates: ${report.counts.candidates}; deployment units: ${report.counts.deploymentUnits}; automated test files: ${report.counts.automatedTests}.`, '',
        '## Candidates', '', ...report.candidates.map(candidate => `- ${candidate.entity.name} (${candidate.entity.authoredId}, ${candidate.category}${candidate.entity.type === 'Capability' ? `, kind: ${candidate.entity.data.kind ?? 'capability'}` : ''}): ${candidate.evidence.length} evidence path(s).`),
        '', '## Gaps', '', ...report.gaps.map(gap => `- ${gap.kind}: ${gap.path ?? gap.entity ?? ''}: ${gap.reason}`),
        '', '## Limits', '', ...report.warnings.map(warning => `- ${warning}`),
        '', '## Complete evidence and provenance', '', '```json', JSON.stringify(report, null, 2), '```'];
    return lines.join('\n');
}
