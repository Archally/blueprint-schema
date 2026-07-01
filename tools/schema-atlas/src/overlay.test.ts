import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOverlays, indexOverlays, OverlayError } from './overlay.js';
import { PolicyReporter } from './policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const overlaysDir = path.join(repoRoot, 'tools', 'schema-atlas', 'overlays');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-overlay-'));
}

describe('overlay loading + guard (VAL-ATL-006)', () => {
  it('loads the repo overlays and indexes them by target', () => {
    const policy = new PolicyReporter();
    const overlays = loadOverlays(overlaysDir, 'v2.7', policy);
    expect(overlays.length).toBeGreaterThan(0);
    const idx = indexOverlays(overlays);
    expect(idx.has('design/domain.schema.yaml#/$defs/operation')).toBe(true);
    expect(policy.hasFailures()).toBe(false);
  });

  it('applies version-scoped overlays only to their version', () => {
    const policy = new PolicyReporter();
    const v26 = loadOverlays(overlaysDir, 'v2.6', policy);
    // The shared changelog overlay applies; the v2.7-scoped overlay must not.
    expect(v26.some((o) => o.id === 'atlas-v2.7')).toBe(false);
    expect(v26.some((o) => o.id === 'atlas-changelog')).toBe(true);
  });

  it('rejects an overlay that tries to override validation truth', () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, 'bad.overlay.yaml'),
      ['id: bad', 'entries:', '  - category: explanatory-note', '    target: metamodel.schema.yaml', '    type: object'].join('\n'),
    );
    const policy = new PolicyReporter();
    expect(() => loadOverlays(dir, 'v2.7', policy)).toThrow(OverlayError);
    expect(policy.hasFailures()).toBe(true);
  });

  it('rejects an unknown overlay category', () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, 'bad2.overlay.yaml'),
      ['id: bad2', 'entries:', '  - category: shadow-schema', '    target: metamodel.schema.yaml', '    note: nope'].join('\n'),
    );
    const policy = new PolicyReporter();
    expect(() => loadOverlays(dir, 'v2.7', policy)).toThrow(OverlayError);
  });
});
