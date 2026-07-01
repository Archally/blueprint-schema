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
