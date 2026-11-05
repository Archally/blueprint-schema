import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './013-handles-to-inprocess-contract.js';

/**
 * The relocation on a model written the way the corpus writes one.
 *
 * The fixture carries every shape the module has to tell apart, and each was measured in the corpus
 * before it was written here: a flow list, a block list, a block list whose first line is a comment,
 * a service that already declares `contracts:` and one that does not, a service already on the new
 * spelling, and a service declaring both - which is the one case the module refuses. The negative
 * control is the model run twice: a module that is not idempotent is unsafe in a chain that may be
 * re-run, and a second pass planning nothing is what says so.
 */
const ARCH_YAML = `version: 1.0.0
name: orders
parties:
  - id: PRT001
    name: Acme
    contexts:
      - id: orders.BC001
        name: orders
        services:
          - id: orders.SVC001
            name: order-api
            kind: api
            handles: [orders.CMD001, orders.QRY001]
            tags:
              - implemented
            contracts:
              openapi:
                file: orders.openapi
          - id: orders.SVC002
            name: pricing-module
            kind: library
            handles:
              # The public entrypoints, not the internal helpers.
              - orders.CMD002
              - orders.CMD003
            tags:
              - implemented
          - id: orders.SVC003
            name: ledger
            kind: worker
            handles:
              - orders.CMD004
            contracts:
              asyncapi:
                file: orders.asyncapi
`;

const ALREADY_YAML = `version: 1.0.0
name: shipping
parties:
  - id: PRT001
    name: Acme
    contexts:
      - id: shipping.BC001
        name: shipping
        services:
          - id: shipping.SVC001
            name: dispatch
            kind: service
            contracts:
              inprocess:
                provide: [shipping.CMD001]
`;

const BOTH_YAML = `version: 1.0.0
name: billing
parties:
  - id: PRT001
    name: Acme
    contexts:
      - id: billing.BC001
        name: billing
        services:
          - id: billing.SVC001
            name: invoicing
            kind: service
            handles: [billing.CMD002]
            contracts:
              inprocess:
                provide: [billing.CMD001]
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handles-inprocess-'));
  for (const slice of ['orders', 'shipping', 'billing']) fs.mkdirSync(path.join(dir, slice), { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders', 'arch.yaml'), ARCH_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'shipping', 'arch.yaml'), ALREADY_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'billing', 'arch.yaml'), BOTH_YAML, 'utf8');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function read(relative: string): string {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

describe('013 handles becomes contracts.inprocess.provide', () => {
  it('keeps a flow list a flow list, because nesting already costs three lines', () => {
    update.apply(dir);
    expect(read('orders/arch.yaml')).toContain('                provide: [orders.CMD001, orders.QRY001]');
  });

  it('inserts into an existing contracts block rather than minting a second one', () => {
    update.apply(dir);
    const text = read('orders/arch.yaml');
    const service = text.slice(text.indexOf('orders.SVC001'), text.indexOf('orders.SVC002'));
    expect(service.match(/^\s*contracts:/gm)).toHaveLength(1);
    expect(service).toContain('              inprocess:');
    expect(service).toContain('              openapi:');
  });

  it('mints a contracts block where the old key stood when the service has none', () => {
    update.apply(dir);
    const text = read('orders/arch.yaml');
    const service = text.slice(text.indexOf('orders.SVC002'), text.indexOf('orders.SVC003'));
    expect(service).toContain('            contracts:\n              inprocess:\n                provide:\n');
    // The surrounding keys keep their order: the refs stay where the author put them.
    expect(service.indexOf('contracts:')).toBeLessThan(service.indexOf('tags:'));
  });

  it('carries a comment inside the list, because a re-emitted entry would drop it', () => {
    update.apply(dir);
    expect(read('orders/arch.yaml')).toContain('                  # The public entrypoints, not the internal helpers.\n                  - orders.CMD002');
  });

  it('leaves no handles key behind', () => {
    update.apply(dir);
    expect(read('orders/arch.yaml')).not.toContain('handles:');
  });

  it('leaves a service already on the new spelling untouched', () => {
    update.apply(dir);
    expect(read('shipping/arch.yaml')).toBe(ALREADY_YAML);
  });

  it('refuses a service declaring both and says why, rather than writing a second provide', () => {
    const result = update.apply(dir);
    expect(read('billing/arch.yaml')).toBe(BOTH_YAML);
    expect(result.warnings.join('\n')).toContain('already declares `contracts.inprocess`');
  });

  it('counts the refs it moved, so the run can be reconciled against an independent count', () => {
    const plan = update.plan(dir);
    const detail = plan.changes.map((change) => change.detail).join(' | ');
    expect(detail).toContain('5 ref(s)');
    expect(detail).toContain('1 `contracts:` block(s) minted');
  });

  it('plans nothing on a second pass', () => {
    update.apply(dir);
    expect(update.plan(dir).changes).toHaveLength(0);
  });

  it('reports a provides key rather than moving it, because the schema dropped it outright', () => {
    fs.writeFileSync(
      path.join(dir, 'orders', 'legacy.yaml'),
      'services:\n  - id: orders.SVC009\n    provides: [orders.CMD009]\n',
      'utf8',
    );
    expect(update.plan(dir).warnings.join('\n')).toContain('`provides:` key(s)');
  });

  it('preserves CRLF line endings', () => {
    fs.writeFileSync(path.join(dir, 'orders', 'arch.yaml'), ARCH_YAML.replace(/\n/g, '\r\n'), 'utf8');
    update.apply(dir);
    const text = read('orders/arch.yaml');
    expect(text).toContain('\r\n');
    expect(text.split('\n').filter((line) => line !== '' && !line.endsWith('\r'))).toHaveLength(0);
  });
});
