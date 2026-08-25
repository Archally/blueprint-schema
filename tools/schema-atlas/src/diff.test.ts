import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAtlasModel } from './introspect.js';
import { resolveSchemaDir } from './schema-io.js';
import { diffModels, type RenameAnnotation } from './diff.js';
import { PolicyReporter } from './policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const from = buildAtlasModel('v2.6', resolveSchemaDir(path.join(repoRoot, 'schema', 'v2.6')));
const to = buildAtlasModel('v2.7', resolveSchemaDir(path.join(repoRoot, 'schema', 'v2.7')));

const renames: RenameAnnotation[] = [
  { renamedFrom: 'design/rg.schema.yaml', target: 'design/infrastructure.schema.yaml', basis: 'explicitly annotated' },
  { renamedFrom: 'design/ui.schema.yaml', target: 'design/interactions.schema.yaml', basis: 'explicitly annotated' },
  { renamedFrom: 'governance/org.schema.yaml', target: 'governance/organization.schema.yaml', basis: 'explicitly annotated' },
];

describe('diffModels (v2.6 → v2.7)', () => {
  it('classifies annotated renames instead of add/remove (VAL-ATL-011, DEC-ATL-19)', () => {
    const policy = new PolicyReporter();
    const diff = diffModels(from, to, renames, policy);
    const renameChanges = diff.changes.filter((c) => c.kind === 'rename');
    expect(renameChanges.length).toBe(3);
    const rg = renameChanges.find((c) => c.target.startsWith('design/rg.schema.yaml'));
    expect(rg?.renameBasis).toContain('annotated');
    expect(rg?.semver).toBe('major');
    // The renamed files must NOT also appear as add/remove.
    expect(diff.changes.some((c) => c.kind === 'remove' && c.target === 'design/rg.schema.yaml')).toBe(false);
    expect(diff.changes.some((c) => c.kind === 'add' && c.target === 'design/infrastructure.schema.yaml')).toBe(false);
  });

  it('captures at least one add and one modify (VAL-ATL-011)', () => {
    const policy = new PolicyReporter();
    const diff = diffModels(from, to, renames, policy);
    expect(diff.changes.some((c) => c.kind === 'add')).toBe(true);
    expect(diff.changes.some((c) => c.kind === 'modify')).toBe(true);
    // Known add: multi-repo `repositories` property (v2.7.1).
    expect(diff.changes.some((c) => c.kind === 'add' && c.target.endsWith('/properties/repositories'))).toBe(true);
  });

  it('degrades to add/remove without a rename annotation (conservative default)', () => {
    const policy = new PolicyReporter();
    const diff = diffModels(from, to, [], policy);
    expect(diff.changes.some((c) => c.kind === 'rename')).toBe(false);
    expect(diff.changes.some((c) => c.kind === 'remove' && c.target === 'design/rg.schema.yaml')).toBe(true);
    expect(diff.changes.some((c) => c.kind === 'add' && c.target === 'design/infrastructure.schema.yaml')).toBe(true);
  });

  it('every change carries provenance and a conservative semver (DEC-ATL-12)', () => {
    const policy = new PolicyReporter();
    const diff = diffModels(from, to, renames, policy);
    for (const c of diff.changes) {
      expect(c.provenance.schema.length).toBeGreaterThan(0);
      expect(['major', 'minor', 'patch']).toContain(c.semver);
    }
  });
});

describe('$ref resolution before comparison (v2.6 → v2.7)', () => {
  // The v2.6 -> v2.7 path extracted three inline definitions into `$defs` and referenced them.
  // Comparing the DECLARATION (`type:` vs `$ref:`) reported all three as breaking type changes,
  // when none of them narrows what a model may say. These pin each of the three distinct shapes.

  const diffOf = () => diffModels(from, to, renames, new PolicyReporter());
  const at = (suffix: string) => diffOf().changes.filter((c) => c.target.endsWith(suffix));

  it('an inline object moved into $defs is NOT a change (repository)', () => {
    // v2.6: inline `type: object`. v2.7: `$ref -> repository_config`, byte-identical once resolved.
    expect(at('/properties/repository').filter((c) => c.summary.includes('type changed'))).toEqual([]);
  });

  it('an inline enum moved into a shared def is NOT a change (model_traits, ref inside items)', () => {
    // The ref sits in `items`, so it is only reachable via TypeInfo.itemRef. Same 10 values.
    const changes = at('/properties/model_traits');
    expect(changes.filter((c) => c.summary.includes('type changed'))).toEqual([]);
    expect(changes.filter((c) => c.summary.includes('enum'))).toEqual([]);
  });

  it('an enum that GAINED a value is additive, not breaking (complexity)', () => {
    // v2.6 had 6 values inline; v2.7 has 7 in metamodel `complexity_pattern`. Widening cannot
    // break a v2.6 model. Reporting it at all is the point - reporting it as major was the bug.
    const changes = at('/properties/complexity');
    expect(changes.filter((c) => c.summary.includes('type changed'))).toEqual([]);
    const enumChange = changes.find((c) => c.summary.includes('enum'));
    expect(enumChange?.semver).toBe('minor');
    expect(enumChange?.summary).toContain('state-management');
  });

  it('the only breaking changes left are the three annotated file renames', () => {
    const breaking = diffOf().changes.filter((c) => c.semver === 'major');
    expect(breaking.length).toBe(3);
    expect(breaking.every((c) => c.kind === 'rename')).toBe(true);
  });

  it('an unresolvable ref falls back to the conservative comparison', () => {
    // The guarantee that makes this safe to ship: resolution is best-effort, and a ref that
    // leaves the model must restore the old behaviour rather than silently report "no change".
    // A def that does not exist cannot resolve, so the declared labels are compared as before.
    const broken = structuredClone(to) as typeof to;
    for (const file of broken.files) file.definitions = [];
    const diff = diffModels(from, broken, renames, new PolicyReporter());
    expect(diff.changes.some((c) => c.summary.includes('type changed'))).toBe(true);
  });
});
