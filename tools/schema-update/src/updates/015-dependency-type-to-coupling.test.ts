import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './015-dependency-type-to-coupling.js';

/**
 * The coupling migration on a context map written the way the corpus writes one.
 *
 * The fixture carries every case the module must tell apart: the four spellings that map, a value
 * naming a medium that does not, an entry already on the new key, an entry declaring both, a
 * trailing comment, an entry whose first key is `type:` itself, and - the case the whole scoping
 * rule exists for - a `type:` belonging to something that is not a dependency.
 *
 * The negative control is the model run twice. A module that is not idempotent is unsafe in a chain
 * that may be re-run, and a second pass planning nothing is what says so.
 */
const ARCH_YAML = `name: "Shop"
version: "1.0.0"
scope: shop

contexts:
  - id: BC001
    name: Catalog
    dependencies:
      - name: International
        relationship: customer-supplier
        type: api
      - name: Modules
        relationship: partnership
        type: events   # the hook bus
      - name: Warehouse
        relationship: conformist
        type: shared-db
      - name: Reporting
        relationship: conformist
        type: grpc
      - name: Payroll
        relationship: conformist
        type: file
      - name: Billing
        relationship: conformist
        coupling: http
      - name: Ledger
        relationship: conformist
        coupling: message
        type: api
      - type: api
        name: Archive
        relationship: conformist
    services:
      - name: catalog-api
        kind: api
        type: internal
`;

/** A second context whose dependency list is written in flow form, which the module refuses. */
const FLOW_YAML = `name: "Shop Flow"
version: "1.0.0"
scope: flow

contexts:
  - id: BC002
    name: Checkout
    dependencies: [{name: Catalog, relationship: conformist, type: api}]
`;

/** Roadmap dependencies name milestones and remain unchanged by the context-dependency update.
 * Both flow lists and block-form milestones carrying a `type:` are covered.
 */
const ROADMAP_YAML = `name: "Shop Roadmap"
version: "1.0.0"

milestones:
  - id: MS001
    name: "Search"
    type: capability
    dependencies: []
  - id: MS002
    name: "Facets"
    dependencies: [MS001]
  - id: MS003
    name: "Ranking"
    dependencies:
      - name: MS002
        type: hard
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-coupling-'));
  fs.mkdirSync(path.join(dir, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'catalog', 'arch.yaml'), ARCH_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'catalog', 'flow.arch.yaml'), FLOW_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'roadmap.yaml'), ROADMAP_YAML, 'utf8');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function read(relative: string): string {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

describe('015 dependency.type becomes coupling', () => {
  it('maps each spelling to the value the contract surface computes', () => {
    update.apply(dir);
    const text = read('catalog/arch.yaml');
    expect(text).toContain('coupling: http');
    expect(text).toContain('coupling: message');
    expect(text).toContain('coupling: shareddata');
    expect(text).toContain('coupling: rpc');
  });

  it('keeps the key at its own column, so the entry is still an entry', () => {
    update.apply(dir);
    expect(read('catalog/arch.yaml')).toContain('      - name: International\n        relationship: customer-supplier\n        coupling: http\n');
  });

  it("keeps the author's trailing comment on the line it was written on", () => {
    update.apply(dir);
    expect(read('catalog/arch.yaml')).toContain('coupling: message   # the hook bus');
  });

  it('rewrites a `type:` that opens its own entry, without losing the dash', () => {
    update.apply(dir);
    expect(read('catalog/arch.yaml')).toContain('      - coupling: http\n        name: Archive\n');
  });

  it('leaves a value naming a medium alone and says why', () => {
    const plan = update.plan(dir);
    expect(read('catalog/arch.yaml')).toContain('        type: file\n');
    expect(plan.warnings.join('\n')).toMatch(/`type: file` names a medium rather than a coupling/);
  });

  it('leaves an entry declaring both keys alone, because one of them is wrong', () => {
    update.apply(dir);
    const text = read('catalog/arch.yaml');
    expect(text).toContain('        coupling: message\n        type: api\n');
    expect(update.plan(dir).warnings.join('\n')).toMatch(/declares `coupling:` as well as `type: api`/);
  });

  it('leaves a flow-form list alone and names the file and line', () => {
    update.apply(dir);
    expect(read('catalog/flow.arch.yaml')).toContain('type: api}]');
    expect(update.plan(dir).warnings.join('\n')).toMatch(/flow\.arch\.yaml:\d+: `dependencies:` is written in flow form/);
  });

  it('never touches a `type:` that is not a dependency\'s', () => {
    update.apply(dir);
    expect(read('catalog/arch.yaml')).toContain('        kind: api\n        type: internal\n');
  });

  it("leaves a roadmap's milestone dependencies alone, in both shapes and in silence", () => {
    update.apply(dir);
    const text = read('roadmap.yaml');
    expect(text).toBe(ROADMAP_YAML);
    expect(text).not.toContain('coupling:');
    const warnings = update.plan(dir).warnings.join('\n');
    expect(warnings).not.toMatch(/roadmap\.yaml/);
  });

  it('reports what it changed, per value pair', () => {
    const plan = update.plan(dir);
    const detail = plan.changes.map((change) => change.detail).join(' ');
    expect(detail).toMatch(/api -> http/);
    expect(detail).toMatch(/events -> message/);
    expect(detail).toMatch(/shared-db -> shareddata/);
    expect(detail).toMatch(/grpc -> rpc/);
  });

  it('is idempotent: a second pass plans nothing', () => {
    update.apply(dir);
    const after = read('catalog/arch.yaml');
    const second = update.plan(dir);
    expect(second.changes).toHaveLength(0);
    update.apply(dir);
    expect(read('catalog/arch.yaml')).toBe(after);
  });

  it('maps a spelling that is itself a coupling value to that value, never to rpc', () => {
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-coupling-own-'));
    const entries = ['mcp', 'cli', 'graphql']
      .map((value) => `      - name: ${value}-peer\n        relationship: conformist\n        type: ${value}\n`)
      .join('');
    fs.writeFileSync(path.join(own, 'arch.yaml'), `name: "Tools"\ncontexts:\n  - id: BC001\n    name: Tools\n    dependencies:\n${entries}`, 'utf8');
    expect(update.plan(own).warnings).toEqual([]);
    update.apply(own);
    const text = fs.readFileSync(path.join(own, 'arch.yaml'), 'utf8');
    for (const value of ['mcp', 'cli', 'graphql']) expect(text).toContain(`coupling: ${value}\n`);
    fs.rmSync(own, { recursive: true, force: true });
  });

  it('plans nothing on a model that declares no dependencies at all', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-coupling-empty-'));
    fs.writeFileSync(path.join(empty, 'arch.yaml'), 'name: "Nothing"\ncontexts: []\n', 'utf8');
    expect(update.plan(empty).changes).toHaveLength(0);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('keeps CRLF line endings where the file uses them', () => {
    const crlf = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-coupling-crlf-'));
    fs.writeFileSync(path.join(crlf, 'arch.yaml'), ARCH_YAML.replace(/\n/g, '\r\n'), 'utf8');
    update.apply(crlf);
    const text = fs.readFileSync(path.join(crlf, 'arch.yaml'), 'utf8');
    expect(text).toContain('coupling: http\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
    fs.rmSync(crlf, { recursive: true, force: true });
  });
});
