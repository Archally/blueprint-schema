import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './009-domain-registry.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-registry-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const full = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

const read = (relativePath: string): string => fs.readFileSync(path.join(dir, relativePath), 'utf8');

/** N spaces of indentation, so an expected block's column never depends on hand-counting spaces. */
const ind = (columns: number, text: string): string => `${' '.repeat(columns)}${text}`;

/** Joins rows with `\n` and appends a trailing newline, the shape every fixture and `write` file uses. */
const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

describe('009 domain registry - seeding a Domain from an object slice', () => {
  it('seeds a Domain from a slice carrying type, description and string subdomains, leaving description on the slice', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: admin'),
      ind(6, 'description: "Back-office."'),
      ind(6, 'type: supporting-domain'),
      ind(6, 'subdomains:'),
      ind(8, '- api'),
      ind(8, '- config'),
      ind(8, '- identity'),
    );
    write('blueprint.yaml', blueprint);

    const result = update.apply(dir);
    expect(result.changes).toHaveLength(1);

    const content = read('blueprint.yaml');
    expect(content).toContain(
      [
        'domains:',
        ind(2, '- id: DMN001'),
        ind(4, 'name: admin'),
        ind(4, 'description: "Back-office."'),
        ind(4, 'type: supporting-domain'),
        ind(4, 'subdomains:'),
        ind(6, '- id: SDM001'),
        ind(8, 'name: api'),
        ind(6, '- id: SDM002'),
        ind(8, 'name: config'),
        ind(6, '- id: SDM003'),
        ind(8, 'name: identity'),
      ].join('\n'),
    );
    // The slice keeps `name` and `description`; `type:` and `subdomains:` are gone, and nothing
    // sits between the reduced slice entry and the registry but the one required blank line.
    expect(content).toContain(`${ind(4, '- name: admin')}\n${ind(6, 'description: "Back-office."')}\n\ndomains:`);
  });

  it('maps subdomain `kind` to `type`, drops an unmapped kind with a warning, and passes an already-typed kind through', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: catalog'),
      ind(6, 'type: core-domain'),
      ind(6, 'subdomains:'),
      ind(8, '- name: cart'),
      ind(10, 'description: "Shopping cart."'),
      ind(10, 'kind: core'),
      ind(8, '- name: checkout'),
      ind(10, 'kind: supporting'),
      ind(8, '- name: pricing'),
      ind(10, 'kind: generic'),
      ind(8, '- name: legacy'),
      ind(10, 'kind: technical-capability'),
      ind(8, '- name: analytics'),
      ind(10, 'kind: codebase-analysis'),
    );
    write('blueprint.yaml', blueprint);

    const result = update.apply(dir);
    const content = read('blueprint.yaml');

    expect(content).toContain(
      [
        ind(4, 'subdomains:'),
        ind(6, '- id: SDM001'),
        ind(8, 'name: cart'),
        ind(8, 'description: "Shopping cart."'),
        ind(8, 'type: core-domain'),
        ind(6, '- id: SDM002'),
        ind(8, 'name: checkout'),
        ind(8, 'type: supporting-domain'),
        ind(6, '- id: SDM003'),
        ind(8, 'name: pricing'),
        ind(8, 'type: generic-domain'),
        ind(6, '- id: SDM004'),
        ind(8, 'name: legacy'),
        ind(8, 'type: technical-capability'),
        ind(6, '- id: SDM005'),
        ind(8, 'name: analytics'),
      ].join('\n'),
    );
    // `analytics` is the last subdomain of the last (only) domain, and the registry is the last
    // block in the file - so a dropped `type:` line would be the very end of the file, and its
    // absence is provable by the file simply ending one line earlier than it would otherwise.
    expect(content.trimEnd().endsWith(ind(8, 'name: analytics'))).toBe(true);
    // The slice itself had no other key, so once `type:`/`subdomains:` move to the registry it is
    // reduced to its bare name.
    expect(content).toContain(`${ind(4, '- name: catalog')}\n\ndomains:`);

    expect(
      result.warnings.some(
        (warning) =>
          warning.startsWith('blueprint.yaml:') &&
          warning.includes('subdomain "analytics" declares kind "codebase-analysis"') &&
          warning.includes('dropped') &&
          warning.includes('classify it by hand in the registry'),
      ),
    ).toBe(true);
  });

  it('moves a comment written directly above a removed key into the registry, and leaves a comment above a kept key where it is', () => {
    const blueprint = lines(
      '# Top-level model description.',
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: warehouse'),
      ind(6, '# inventory description'),
      ind(6, 'description: "Storage."'),
      ind(6, 'type: core-domain'),
      ind(6, '# subdomain breakdown'),
      ind(6, 'subdomains:'),
      ind(8, '- stock'),
    );
    write('blueprint.yaml', blueprint);
    update.apply(dir);
    const content = read('blueprint.yaml');

    expect(content.startsWith('# Top-level model description.\n')).toBe(true);
    // Per the spec's case 11: a comment above a REMOVED key (`subdomains:`) moves into the
    // registry with it and is gone from the slice; a comment above a KEPT key (`description:`)
    // "stays where it is" - unmoved, a single copy, still attached to the slice's own line.
    expect(content).toContain(
      [
        ind(2, '- id: DMN001'),
        ind(4, 'name: warehouse'),
        ind(4, 'description: "Storage."'),
        ind(4, 'type: core-domain'),
        ind(4, '# subdomain breakdown'),
        ind(4, 'subdomains:'),
        ind(6, '- id: SDM001'),
        ind(8, 'name: stock'),
      ].join('\n'),
    );
    expect(content).toContain(
      [ind(4, '- name: warehouse'), ind(6, '# inventory description'), ind(6, 'description: "Storage."')].join('\n'),
    );
    // Each comment appears exactly once: "inventory description" never left the slice (and is not
    // ALSO duplicated into the registry), and "subdomain breakdown" never stayed behind on it.
    expect(content.split('# inventory description').length - 1).toBe(1);
    expect(content.split('# subdomain breakdown').length - 1).toBe(1);
  });

  it('copies a block-scalar description verbatim into the registry, re-indented, and leaves it on the slice', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: reporting'),
      ind(6, 'description: >'),
      ind(8, 'Analytics and'),
      ind(8, 'reporting engine.'),
      ind(6, 'type: supporting-domain'),
    );
    write('blueprint.yaml', blueprint);
    update.apply(dir);
    const content = read('blueprint.yaml');

    expect(content).toContain(
      [
        ind(2, '- id: DMN001'),
        ind(4, 'name: reporting'),
        ind(4, 'description: >'),
        ind(6, 'Analytics and'),
        ind(6, 'reporting engine.'),
        ind(4, 'type: supporting-domain'),
      ].join('\n'),
    );
    expect(content).toContain(
      [ind(4, '- name: reporting'), ind(6, 'description: >'), ind(8, 'Analytics and'), ind(8, 'reporting engine.')].join(
        '\n',
      ),
    );
  });

  it('seeds nothing from a slice with no type, no subdomains and no domain_ref pointing at it', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: legacy'),
      ind(6, 'description: "old"'),
    );
    write('blueprint.yaml', blueprint);

    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings).toContain('Every slice is a folder already, no document names a domain in prose, and every domain_ref is an id - nothing to promote.');
  });

  it('reports and skips an object slice entry with no `name:` key', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- description: "No name here."'),
      ind(6, 'type: core-domain'),
    );
    write('blueprint.yaml', blueprint);

    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings).toContain('blueprint.yaml:6: slice entry without a name - skipped');
  });

  it('reports and skips an object slice entry whose dash line opens with `type:` instead of `name:`', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- type: core-domain'),
      ind(6, 'name: weird'),
    );
    write('blueprint.yaml', blueprint);

    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings.some((warning) => warning.includes('blueprint.yaml') && /\bname\b/i.test(warning))).toBe(true);
  });
});

describe('009 domain registry - flow-mapping subdomains and slices', () => {
  it('parses a flow-mapping subdomain item like an object item, key by key, keeping a nested flow value verbatim', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: hr'),
      ind(6, 'type: supporting-domain'),
      ind(6, 'subdomains:'),
      ind(8, '- { name: employment, description: "Employee lifecycle.", kind: core, owner: { team: TM002 } }'),
    );
    write('blueprint.yaml', blueprint);
    update.apply(dir);
    const content = read('blueprint.yaml');

    expect(content).toContain(
      [
        ind(6, '- id: SDM001'),
        ind(8, 'name: employment'),
        ind(8, 'description: "Employee lifecycle."'),
        ind(8, 'type: core-domain'),
        ind(8, 'owner: { team: TM002 }'),
      ].join('\n'),
    );
  });

  it('refuses a flow-mapping slice entry and leaves it unchanged', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- { name: orders, type: core-domain }'),
    );
    write('blueprint.yaml', blueprint);

    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings).toContain('blueprint.yaml:6: flow-style slice entry - rewrite it in block style, then run the update again');

    update.apply(dir);
    expect(read('blueprint.yaml')).toBe(blueprint);
  });
});

describe('009 domain registry - seeding a Domain from a string slice named by a domain_ref', () => {
  it('seeds only id and name, and leaves the string slice line untouched', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- billing'),
    );
    const arch = lines(
      'version: "1.0.0"',
      'contexts:',
      ind(2, '- id: BC001'),
      ind(4, 'name: Foo'),
      ind(4, 'domain_ref: billing'),
      ind(4, 'services: []'),
    );
    write('blueprint.yaml', blueprint);
    write('arch.yaml', arch);

    update.apply(dir);
    const content = read('blueprint.yaml');
    expect(content).toContain(`${ind(4, '- billing')}\n`);
    expect(content).toContain(['domains:', ind(2, '- id: DMN001'), ind(4, 'name: billing')].join('\n'));
    expect(read('arch.yaml')).toContain('domain_ref: DMN001');
  });
});

describe('009 domain registry - domain_ref rewrite', () => {
  it('rewrites `domain_ref` in every arch file naming a seeded slice, dropping quotes and keeping a trailing comment', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: orders'),
      ind(6, 'type: core-domain'),
    );
    const archRoot = lines(
      'version: "1.0.0"',
      'contexts:',
      ind(2, '- id: BC001'),
      ind(4, 'name: Orders'),
      ind(4, 'domain_ref: "orders"'),
      ind(4, 'services:'),
      ind(6, '- id: SVC001'),
      ind(8, 'name: OrderService'),
    );
    const archSub = lines(
      'version: "1.0.0"',
      'contexts:',
      ind(2, '- id: BC002'),
      ind(4, 'name: OrdersSub'),
      ind(4, 'domain_ref: orders   # legacy pointer'),
      ind(4, 'services:'),
      ind(6, '- id: SVC002'),
      ind(8, 'name: SubService'),
    );
    write('blueprint.yaml', blueprint);
    write('arch.yaml', archRoot);
    write('orders/orders.arch.yaml', archSub);

    const result = update.apply(dir);

    expect(read('arch.yaml')).toContain(`${ind(4, 'domain_ref: DMN001')}\n`);
    expect(read('arch.yaml')).not.toContain('"orders"');

    const subContent = read('orders/orders.arch.yaml');
    expect(subContent).toContain('domain_ref: DMN001');
    expect(subContent).toContain('# legacy pointer');

    const archChanges = result.changes.filter((change) => change.path !== 'blueprint.yaml');
    expect(archChanges).toHaveLength(2);
    expect(archChanges.map((change) => change.path).sort()).toEqual(['arch.yaml', 'orders/orders.arch.yaml']);
  });

  it('reports a `domain_ref` that names no slice, by file and line, and leaves the line alone', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: billing'),
      ind(6, 'type: supporting-domain'),
    );
    const arch = lines(
      'version: "1.0.0"',
      'contexts:',
      ind(2, '- id: BC001'),
      ind(4, 'name: Foo'),
      ind(4, 'domain_ref: nowhere'),
      ind(4, 'services: []'),
    );
    write('blueprint.yaml', blueprint);
    write('arch.yaml', arch);

    const { warnings } = update.plan(dir);
    expect(warnings).toContain('arch.yaml:5: domain_ref "nowhere" names no domain the model declares - left alone, point it at a DMN### by hand');

    update.apply(dir);
    expect(read('arch.yaml')).toContain('domain_ref: nowhere');
  });

  it('leaves an already-typed `domain_ref: DMN001` alone, with no change and no warning about it', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: legacy'),
      ind(6, 'description: "old"'),
    );
    const arch = lines(
      'version: "1.0.0"',
      'contexts:',
      ind(2, '- id: BC001'),
      ind(4, 'name: Foo'),
      ind(4, 'domain_ref: DMN001'),
      ind(4, 'services: []'),
    );
    write('blueprint.yaml', blueprint);
    write('arch.yaml', arch);

    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings.some((warning) => warning.includes('domain_ref') && warning.includes('DMN001'))).toBe(false);
    expect(read('arch.yaml')).toContain('domain_ref: DMN001');
  });
});

describe('009 domain registry - placement', () => {
  it('appends a newly promoted Domain inside an existing `domains:` block, continuing above the highest DMN/SDM present', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: shipping'),
      ind(6, 'type: supporting-domain'),
      ind(6, 'subdomains:'),
      ind(8, '- carrier'),
      'domains:',
      ind(2, '- id: DMN003'),
      ind(4, 'name: existing'),
      ind(4, 'subdomains:'),
      ind(6, '- id: SDM005'),
      ind(8, 'name: existingsub'),
    );
    write('blueprint.yaml', blueprint);
    update.apply(dir);
    const content = read('blueprint.yaml');

    expect(content).toContain(
      [
        'domains:',
        ind(2, '- id: DMN003'),
        ind(4, 'name: existing'),
        ind(4, 'subdomains:'),
        ind(6, '- id: SDM005'),
        ind(8, 'name: existingsub'),
        ind(2, '- id: DMN004'),
        ind(4, 'name: shipping'),
        ind(4, 'type: supporting-domain'),
        ind(4, 'subdomains:'),
        ind(6, '- id: SDM006'),
        ind(8, 'name: carrier'),
      ].join('\n'),
    );
    expect(content).toContain(`${ind(4, '- name: shipping')}\n`);
    expect(content).not.toContain(`${ind(4, '- name: shipping')}\n${ind(6, 'type:')}`);
  });

  it('inserts the registry between `layout:` and the key that follows it, with exactly one blank line', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: ops'),
      ind(6, 'type: core-domain'),
      'constitution:',
      ind(2, 'invariants: []'),
    );
    write('blueprint.yaml', blueprint);
    update.apply(dir);

    expect(read('blueprint.yaml')).toContain(
      [
        'layout:',
        ind(2, 'slices:'),
        ind(4, '- name: ops'),
        '',
        'domains:',
        ind(2, '- id: DMN001'),
        ind(4, 'name: ops'),
        ind(4, 'type: core-domain'),
        'constitution:',
        ind(2, 'invariants: []'),
      ].join('\n'),
    );
  });

  it('appends the registry at the end of the file when `layout:` is the last block', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: ops'),
      ind(6, 'type: core-domain'),
    );
    write('blueprint.yaml', blueprint);
    update.apply(dir);

    const expected = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: ops'),
      '',
      'domains:',
      ind(2, '- id: DMN001'),
      ind(4, 'name: ops'),
      ind(4, 'type: core-domain'),
    );
    expect(read('blueprint.yaml')).toBe(expected);
  });
});

describe('009 domain registry - safety and idempotency', () => {
  it('is idempotent: a second apply plans nothing and leaves the file byte-identical', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: ops'),
      ind(6, 'type: core-domain'),
    );
    write('blueprint.yaml', blueprint);
    update.apply(dir);
    const first = read('blueprint.yaml');

    const second = update.apply(dir);
    expect(second.changes).toHaveLength(0);
    expect(second.warnings).toContain('Every slice is a folder already, no document names a domain in prose, and every domain_ref is an id - nothing to promote.');
    expect(read('blueprint.yaml')).toBe(first);
  });

  it('reports flow-style `slices:` instead of rewriting it', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices: [orders, billing]'),
    );
    write('blueprint.yaml', blueprint);

    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings).toContain('blueprint.yaml: flow-style `slices:` - rewrite it in block style, then run the update again');

    update.apply(dir);
    expect(read('blueprint.yaml')).toBe(blueprint);
  });

  it('reports a model with no `layout:` block at all', () => {
    const blueprint = lines('version: "1.0.0"', 'schemaVersion: "2.8.0"', 'name: "Test"');
    write('blueprint.yaml', blueprint);

    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings).toContain('blueprint.yaml: no `layout.slices` block - nothing to promote');
  });

  it('reports a missing blueprint.yaml rather than throwing', () => {
    const { changes, warnings } = update.plan(dir);
    expect(changes).toHaveLength(0);
    expect(warnings).toContain('blueprint.yaml: not found - nothing to promote');
  });

  it('computes without writing in plan(), and writes with applied:true/errors:[] in apply()', () => {
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: ops'),
      ind(6, 'type: core-domain'),
    );
    write('blueprint.yaml', blueprint);
    const original = read('blueprint.yaml');

    const plan = update.plan(dir);
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(read('blueprint.yaml')).toBe(original);

    const result = update.apply(dir);
    expect(result.applied).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('preserves CRLF line endings across both the seeded blueprint.yaml and a rewritten arch file', () => {
    const toCRLF = (text: string): string => text.replace(/\n/g, '\r\n');
    const blueprint = lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ind(4, '- name: orders'),
      ind(6, 'type: core-domain'),
    );
    const arch = lines(
      'version: "1.0.0"',
      'contexts:',
      ind(2, '- id: BC001'),
      ind(4, 'name: Orders'),
      ind(4, 'domain_ref: "orders"'),
      ind(4, 'services: []'),
    );
    write('blueprint.yaml', toCRLF(blueprint));
    write('arch.yaml', toCRLF(arch));

    update.apply(dir);

    for (const relativePath of ['blueprint.yaml', 'arch.yaml']) {
      const content = read(relativePath);
      expect(content).toContain('\r\n');
      expect(content.replace(/\r\n/g, '')).not.toContain('\n');
    }

    const normalizedBlueprint = read('blueprint.yaml').replace(/\r\n/g, '\n');
    expect(normalizedBlueprint).toContain(
      ['domains:', ind(2, '- id: DMN001'), ind(4, 'name: orders'), ind(4, 'type: core-domain')].join('\n'),
    );
    const normalizedArch = read('arch.yaml').replace(/\r\n/g, '\n');
    expect(normalizedArch).toContain('domain_ref: DMN001');
  });
});

describe('009 domain registry - seeding a Domain from a glossary map', () => {
  /** A model whose slices are bare strings, so nothing seeds from the layout and the glossary is the only source. */
  const bareSlices = (...slices: string[]): string =>
    lines(
      'version: "1.0.0"',
      'schemaVersion: "2.8.0"',
      'name: "Test"',
      'layout:',
      ind(2, 'slices:'),
      ...slices.map((slice) => ind(4, `- ${slice}`)),
    );

  it('seeds a Domain from each glossary key, carrying the prose as the description', () => {
    write('blueprint.yaml', bareSlices('catalog', 'sales'));
    write(
      'arch.yaml',
      lines('version: "1.0.0"', 'domains:', ind(2, 'catalog: "What we sell."'), ind(2, 'sales: "How we sell it."')),
    );

    const result = update.apply(dir);
    expect(result.applied).toBe(true);
    expect(result.changes).toHaveLength(2);

    expect(read('blueprint.yaml')).toContain(
      [
        'domains:',
        ind(2, '- id: DMN001'),
        ind(4, 'name: catalog'),
        ind(4, 'description: "What we sell."'),
        ind(2, '- id: DMN002'),
        ind(4, 'name: sales'),
        ind(4, 'description: "How we sell it."'),
      ].join('\n'),
    );
  });

  it('removes the map when every key promoted, and keeps the rest of the document', () => {
    write('blueprint.yaml', bareSlices('catalog'));
    write('arch.yaml', lines('version: "1.0.0"', 'domains:', ind(2, 'catalog: "What we sell."'), 'parties: []'));

    update.apply(dir);

    const arch = read('arch.yaml');
    expect(arch).not.toContain('domains:');
    expect(arch).toContain('version: "1.0.0"');
    expect(arch).toContain('parties: []');
  });

  it('keeps the map alive for a key that did not promote, and removes only the one that did', () => {
    write(
      'blueprint.yaml',
      lines(
        'version: "1.0.0"',
        'schemaVersion: "2.8.0"',
        'layout:',
        ind(2, 'slices:'),
        ind(4, '- name: catalog'),
        ind(6, 'type: core-domain'),
      ),
    );
    write(
      'arch.yaml',
      lines('version: "1.0.0"', 'domains:', ind(2, 'catalog: "Already a domain."'), ind(2, 'pricing: "Only here."')),
    );

    const result = update.apply(dir);

    const arch = read('arch.yaml');
    expect(arch).toContain('domains:');
    expect(arch).toContain(ind(2, 'catalog: "Already a domain."'));
    expect(arch).not.toContain('pricing:');
    expect(result.warnings.some((warning) => warning.includes('domains["catalog"] names a domain the registry already declares (DMN001)'))).toBe(true);
  });

  it('leaves a key holding a registry id rather than prose, and says so', () => {
    write('blueprint.yaml', bareSlices('catalog'));
    write('arch.yaml', lines('version: "1.0.0"', 'domains:', ind(2, 'catalog: DMN007')));

    const result = update.apply(dir);

    expect(read('arch.yaml')).toContain(ind(2, 'catalog: DMN007'));
    expect(result.warnings.some((warning) => warning.includes('holds the id DMN007 rather than prose'))).toBe(true);
  });

  it('resolves a domain_ref that names a domain only the glossary declared', () => {
    write('blueprint.yaml', bareSlices('catalog'));
    write(
      'orders/orders.arch.yaml',
      lines(
        'version: "1.0.0"',
        'domains:',
        ind(2, 'fulfilment: "Getting it there."'),
        'contexts:',
        ind(2, '- id: BC001'),
        ind(4, 'domain_ref: fulfilment'),
      ),
    );

    const result = update.apply(dir);

    const arch = read('orders/orders.arch.yaml');
    expect(arch).toContain(ind(4, 'domain_ref: DMN001'));
    expect(arch).not.toContain('fulfilment: "Getting it there."');
    expect(result.warnings.some((warning) => warning.includes('names no domain the model declares'))).toBe(false);
  });

  it('applies a reference rewrite and a glossary removal to one file in a single write', () => {
    write('blueprint.yaml', bareSlices('catalog'));
    write(
      'arch.yaml',
      lines(
        'version: "1.0.0"',
        'domains:',
        ind(2, 'billing: "Money in."'),
        'contexts:',
        ind(2, '- id: BC001'),
        ind(4, 'domain_ref: billing'),
        ind(2, '- id: BC002'),
        ind(4, 'domain_ref: billing'),
      ),
    );

    update.apply(dir);

    const arch = read('arch.yaml');
    expect(arch).not.toContain('billing: "Money in."');
    expect(arch.match(/domain_ref: DMN001/g)).toHaveLength(2);
    expect(arch).not.toContain('domain_ref: billing');
  });

  it('promotes a glossary carried by a process document', () => {
    write('blueprint.yaml', bareSlices('catalog'));
    write('orders/checkout.story.yaml', lines('version: "1.0.0"', 'domains:', ind(2, 'checkout: "Pay and confirm."')));

    const result = update.apply(dir);

    expect(read('blueprint.yaml')).toContain(ind(4, 'description: "Pay and confirm."'));
    expect(read('orders/checkout.story.yaml')).not.toContain('domains:');
    expect(result.changes[0]!.detail).toContain('orders/checkout.story.yaml');
  });

  it('carries a block-scalar description into the registry, re-indented', () => {
    write('blueprint.yaml', bareSlices('catalog'));
    write(
      'arch.yaml',
      lines('version: "1.0.0"', 'domains:', ind(2, 'catalog: >'), ind(4, 'What we sell,'), ind(4, 'in two lines.')),
    );

    update.apply(dir);

    expect(read('blueprint.yaml')).toContain(
      [ind(4, 'description: >'), ind(6, 'What we sell,'), ind(6, 'in two lines.')].join('\n'),
    );
  });

  it('is idempotent: a second apply promotes nothing and leaves both files byte-identical', () => {
    write('blueprint.yaml', bareSlices('catalog'));
    write('arch.yaml', lines('version: "1.0.0"', 'domains:', ind(2, 'catalog: "What we sell."')));

    update.apply(dir);
    const blueprint = read('blueprint.yaml');
    const arch = read('arch.yaml');

    const second = update.apply(dir);
    expect(second.changes).toHaveLength(0);
    expect(read('blueprint.yaml')).toBe(blueprint);
    expect(read('arch.yaml')).toBe(arch);
  });

  it('continues the id sequence after the slices rather than colliding with them', () => {
    write(
      'blueprint.yaml',
      lines(
        'version: "1.0.0"',
        'schemaVersion: "2.8.0"',
        'layout:',
        ind(2, 'slices:'),
        ind(4, '- name: catalog'),
        ind(6, 'type: core-domain'),
      ),
    );
    write('arch.yaml', lines('version: "1.0.0"', 'domains:', ind(2, 'pricing: "What it costs."')));

    update.apply(dir);

    const content = read('blueprint.yaml');
    expect(content).toContain(ind(4, 'name: catalog'));
    expect(content).toContain([ind(2, '- id: DMN002'), ind(4, 'name: pricing')].join('\n'));
  });
});
