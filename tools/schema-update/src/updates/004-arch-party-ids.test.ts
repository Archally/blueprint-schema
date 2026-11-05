import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './004-arch-party-ids.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-ids-'));
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

const ARCH = (name: string) => `version: "1.0.0"\nparties:\n  - name: ${name}\n    env: production\n    contexts: []\n`;

describe('004 arch party ids - assignment', () => {
  it('gives a party without an id the next free PRT###', () => {
    write('arch.yaml', ARCH('Acme'));
    expect(update.apply(dir).applied).toBe(true);
    expect(read('arch.yaml')).toContain('  - id: PRT001\n    name: Acme');
  });

  it('adopts the org id when the names match EXACTLY', () => {
    write('arch.yaml', ARCH('Acme'));
    write('organization.yaml', 'parties:\n  - id: PRT007\n    name: Acme\n');
    update.apply(dir);
    expect(read('arch.yaml')).toContain('id: PRT007');
  });

  /**
   * A party is a partial class: parts unify on the EXACT identifier. "PrestaShop" and
   * "PrestaShop SA" are two identifiers, so they are two parties - matching them would be
   * inference, performed once and written to disk.
   */
  it('does NOT adopt on a near-miss name - it allocates a fresh id', () => {
    write('arch.yaml', ARCH('Acme'));
    write('organization.yaml', 'parties:\n  - id: PRT001\n    name: Acme SA\n');
    update.apply(dir);
    // PRT001 is taken by the org party, so the arch party must get the next one.
    expect(read('arch.yaml')).toContain('id: PRT002');
  });

  it('gives one party declared across many slices a SINGLE id', () => {
    write('billing/arch.yaml', ARCH('Acme'));
    write('orders/arch.yaml', ARCH('Acme'));
    write('shipping/arch.yaml', ARCH('Acme'));
    update.apply(dir);
    for (const slice of ['billing', 'orders', 'shipping']) {
      expect(read(`${slice}/arch.yaml`)).toContain('id: PRT001');
    }
  });

  it('gives different parties different ids', () => {
    write('arch.yaml', `version: "1.0.0"\nparties:\n  - name: Acme\n    contexts: []\n  - name: Globex\n    contexts: []\n`);
    update.apply(dir);
    const content = read('arch.yaml');
    expect(content).toContain('- id: PRT001\n    name: Acme');
    expect(content).toContain('- id: PRT002\n    name: Globex');
  });

  it('allocates above every PRT### already used anywhere in the model', () => {
    write('arch.yaml', ARCH('Acme'));
    write('organization.yaml', 'parties:\n  - id: PRT013\n    name: Globex\n');
    update.apply(dir);
    expect(read('arch.yaml')).toContain('id: PRT014');
  });

  it('refuses to adopt when the org declares one name with two ids', () => {
    write('arch.yaml', ARCH('Acme'));
    write('organization.yaml', 'parties:\n  - id: PRT001\n    name: Acme\n  - id: PRT002\n    name: Acme\n');
    const result = update.apply(dir);
    expect(result.warnings.some((w) => w.includes('more than one PRT###'))).toBe(true);
    expect(read('arch.yaml')).toContain('id: PRT003');
  });
});

describe('004 arch party ids - safety', () => {
  it('is idempotent: a second run plans nothing', () => {
    write('arch.yaml', ARCH('Acme'));
    update.apply(dir);
    const second = update.plan(dir);
    expect(second.changes).toHaveLength(0);
    expect(update.apply(dir).applied).toBe(false);
  });

  it('leaves an existing id alone', () => {
    write('arch.yaml', `version: "1.0.0"\nparties:\n  - id: PRT099\n    name: Acme\n    contexts: []\n`);
    expect(update.plan(dir).changes).toHaveLength(0);
  });

  /** A parse/stringify round-trip would reformat the file and bury the one-line change. */
  it('preserves comments, key order and blank lines', () => {
    const original = `# top comment\nversion: "1.0.0"\n\nparties:\n  # who runs it\n  - name: Acme   # trailing\n    env: production\n    contexts: []\n`;
    write('arch.yaml', original);
    update.apply(dir);
    const after = read('arch.yaml');
    expect(after).toContain('# top comment');
    expect(after).toContain('  # who runs it');
    expect(after).toContain('name: Acme   # trailing');
    expect(after).toContain('\n\nparties:');
  });

  it('preserves CRLF line endings and never mixes them', () => {
    write('arch.yaml', ARCH('Acme').replace(/\n/g, '\r\n'));
    update.apply(dir);
    const after = read('arch.yaml');
    expect(after).toContain('\r\n  - id: PRT001\r\n');
    expect(/(?<!\r)\n/.test(after)).toBe(false);
  });

  it('preserves LF line endings on an LF file', () => {
    write('arch.yaml', ARCH('Acme'));
    update.apply(dir);
    expect(read('arch.yaml')).not.toContain('\r');
  });

  it('keeps keys aligned when the dash uses non-standard spacing', () => {
    write('arch.yaml', `parties:\n  -   name: Acme\n      contexts: []\n`);
    update.apply(dir);
    // The id takes the dash; the displaced key must land in the SAME column or the mapping breaks.
    expect(read('arch.yaml')).toBe(`parties:\n  -   id: PRT001\n      name: Acme\n      contexts: []\n`);
  });

  it('reports flow style instead of rewriting it', () => {
    write('arch.yaml', 'parties: [{name: Acme}]\n');
    const plan = update.plan(dir);
    expect(plan.changes).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes('flow-style'))).toBe(true);
  });

  it('ignores parties declared in files that are not arch or org documents', () => {
    write('domain.yaml', 'parties:\n  - name: Acme\n');
    expect(update.plan(dir).changes).toHaveLength(0);
    expect(read('domain.yaml')).not.toContain('PRT');
  });

  it('does not confuse a nested `- name:` with a party entry', () => {
    write(
      'arch.yaml',
      `parties:\n  - name: Acme\n    contexts:\n      - id: BC001\n        name: Billing\n        services:\n          - name: invoicing\n`,
    );
    update.apply(dir);
    const content = read('arch.yaml');
    expect(content.match(/PRT001/g)).toHaveLength(1);
    expect(content).toContain('          - name: invoicing');
  });

  it('reports a missing directory rather than throwing', () => {
    const plan = update.plan(path.join(dir, 'nope'));
    expect(plan.changes).toHaveLength(0);
    expect(plan.warnings[0]).toContain('Directory not found');
  });
});
