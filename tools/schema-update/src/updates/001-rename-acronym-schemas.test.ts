import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './001-rename-acronym-schemas.js';

/**
 * The hop from 2.6 to 2.7, and specifically the half of it that is a statement rather than a rename.
 *
 * A model says which schema it is written against in its own `schemaVersion`, and the directory it
 * sits in says the same thing a second time. Only the first travels with the file. Since this hop
 * COPIES rather than moves, both trees stay on disk, so a version left behind is not a transient
 * state that the next hop overwrites - it is a document that says 2.6 sitting in `v2.7/` for good.
 */
const ROOT = `schemaVersion: "2.6.0"
version: "1.0.0"
name: Shop
contexts:
  - orders
`;
const DOMAIN = `schemaVersion: "2.6.0"
version: "1.0.0"
scope: orders
operations:
  placeOrder:
    id: orders.CMD001
    kind: command
    name: Place Order
`;

let dir: string;
const model = () => path.join(dir, 'v2.6');
const sibling = () => path.join(dir, 'v2.7');
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');

function write(files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(model(), name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-001-'));
  fs.mkdirSync(path.join(dir, 'v2.6'), { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('001 rename-acronym-schemas - the version a copied tree declares', () => {
  it('bumps every schemaVersion in the copy and leaves the source at 2.6.0', () => {
    write({ 'blueprint.yaml': ROOT, 'orders/domain.yaml': DOMAIN });
    const result = update.apply(model());

    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(true);
    expect(read(sibling(), 'blueprint.yaml')).toContain('schemaVersion: "2.7.0"');
    expect(read(sibling(), 'orders/domain.yaml')).toContain('schemaVersion: "2.7.0"');
    // The predecessor is kept, and kept HONEST: it is still a 2.6 model and still says so.
    expect(read(model(), 'blueprint.yaml')).toContain('schemaVersion: "2.6.0"');
    expect(read(model(), 'orders/domain.yaml')).toContain('schemaVersion: "2.6.0"');
  });

  it('copies and bumps a model with no acronym files at all', () => {
    // A model without acronym-named files still receives the version update and target directory.
    write({ 'blueprint.yaml': ROOT });
    const result = update.apply(model());

    expect(result.applied).toBe(true);
    expect(fs.existsSync(sibling())).toBe(true);
    expect(read(sibling(), 'blueprint.yaml')).toContain('schemaVersion: "2.7.0"');
  });

  it('plans nothing for a model already at 2.7.0, so a second run is a no-op', () => {
    write({ 'blueprint.yaml': ROOT.replace('2.6.0', '2.7.0') });
    const plan = update.plan(model());

    expect(plan.changes.filter((c) => c.detail.startsWith('schemaVersion'))).toEqual([]);
  });

  it('rewrites the version without disturbing anything else in the file', () => {
    const quirky = 'schemaVersion: 2.6.0  # pinned deliberately\r\nversion: "1.0.0"\r\nname: Shop\r\n';
    write({ 'blueprint.yaml': quirky });
    update.apply(model());

    const after = read(sibling(), 'blueprint.yaml');
    // Unquoted form, trailing comment and CRLF all survive: only the three digits move.
    expect(after).toBe('schemaVersion: 2.7.0  # pinned deliberately\r\nversion: "1.0.0"\r\nname: Shop\r\n');
  });

  it('renames the acronym files and bumps the version in the same run', () => {
    write({ 'blueprint.yaml': ROOT, 'orders/rg.yaml': DOMAIN });
    const result = update.apply(model());

    expect(result.applied).toBe(true);
    expect(fs.existsSync(path.join(sibling(), 'orders/infrastructure.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(sibling(), 'orders/rg.yaml'))).toBe(false);
    expect(read(sibling(), 'orders/infrastructure.yaml')).toContain('schemaVersion: "2.7.0"');
    // And the source keeps both its name and its version.
    expect(fs.existsSync(path.join(model(), 'orders/rg.yaml'))).toBe(true);
    expect(read(model(), 'orders/rg.yaml')).toContain('schemaVersion: "2.6.0"');
  });
});
