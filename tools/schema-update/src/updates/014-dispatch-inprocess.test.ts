import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './014-dispatch-inprocess.js';

/**
 * The value convergence on a model written the way the corpus writes one.
 *
 * The fixture carries the shapes the module has to tell apart, and each was measured before it was
 * written here: the bare value, a quoted one, a trailing comment, the same words inside a prose
 * string the author wrote, and a flow mapping. The prose case is the one that matters - an
 * unanchored search over these models returns 162 hits where key position returns 139, and every
 * one of the 23 between them is a sentence.
 */
const DOMAIN_YAML = `name: "Orders"
version: "1.0.0"
scope: orders

operations:
  - id: orders.CMD001
    name: placeOrder
    kind: command
    dispatch: in-process
  - id: orders.CMD002
    name: priceOrder
    kind: command
    dispatch: "in-process"   # priced by the module, not over a wire
  - id: orders.CMD003
    name: shipOrder
    kind: command
    dispatch: sync
    summary: "Called by placeOrder, which is dispatch: in-process and therefore invisible to the gateway."
  - id: orders.CMD004
    name: closeOrder
    kind: command
    dispatch: inprocess
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-inprocess-'));
  fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders', 'domain.yaml'), DOMAIN_YAML, 'utf8');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function read(relative: string): string {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

describe('014 dispatch in-process becomes inprocess', () => {
  it('rewrites the bare value', () => {
    update.apply(dir);
    expect(read('orders/domain.yaml')).toContain('    dispatch: inprocess\n  - id: orders.CMD002');
  });

  it('keeps the author\'s quotes and the comment beside the value', () => {
    update.apply(dir);
    expect(read('orders/domain.yaml')).toContain('dispatch: "inprocess"   # priced by the module, not over a wire');
  });

  it('leaves the same words alone inside a string the author wrote', () => {
    update.apply(dir);
    expect(read('orders/domain.yaml')).toContain('which is dispatch: in-process and therefore invisible');
  });

  it('counts only what it rewrote, so a run can be reconciled against an independent count', () => {
    const plan = update.plan(dir);
    expect(plan.changes.map((change) => change.detail).join(' ')).toContain('2 operation(s)');
  });

  it('reports a flow mapping rather than re-forming the line', () => {
    fs.writeFileSync(
      path.join(dir, 'orders', 'flow.yaml'),
      'operations:\n  - {id: orders.CMD005, dispatch: in-process}\n',
      'utf8',
    );
    const plan = update.plan(dir);
    expect(plan.warnings.join('\n')).toContain('inside a flow mapping');
    expect(plan.changes.some((change) => change.path === 'orders/flow.yaml')).toBe(false);
  });

  it('names a prose mention without rewriting it', () => {
    fs.writeFileSync(path.join(dir, 'GUIDE.md'), 'Every operator op is dispatch: in-process.\n', 'utf8');
    expect(update.plan(dir).warnings.join('\n')).toContain('GUIDE.md: 1 mention(s)');
  });

  it('plans nothing on a second pass', () => {
    update.apply(dir);
    expect(update.plan(dir).changes).toHaveLength(0);
  });

  it('preserves CRLF line endings, because whole models are written that way', () => {
    fs.writeFileSync(path.join(dir, 'orders', 'domain.yaml'), DOMAIN_YAML.replace(/\n/g, '\r\n'), 'utf8');
    update.apply(dir);
    const text = read('orders/domain.yaml');
    expect(text).toContain('dispatch: inprocess\r\n');
    expect(text.split('\n').filter((line) => line !== '' && !line.endsWith('\r'))).toHaveLength(0);
  });
});
