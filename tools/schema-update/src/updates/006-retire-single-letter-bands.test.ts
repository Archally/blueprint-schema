import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update, rebandText, BAND_RENAMES } from './006-retire-single-letter-bands.js';
import { BAND_RENAMES as WATCH_RENAMES } from './010-retire-watch-item-band.js';
// The canonical table lives in the schema this module migrates a model onto - `x-retired-bands` in
// the v2.8 metamodel, which the validator reads to report a model still using an old band. This
// package compiles with `rootDir: src` and cannot reach it at build time; the test can, and that is
// what keeps the two lists from drifting.
import YAML from 'yaml';

const METAMODEL = process.env.BLUEPRINT_TEST_SCHEMA_ROOT
  ? path.join(process.env.BLUEPRINT_TEST_SCHEMA_ROOT, 'metamodel.schema.yaml')
  : path.resolve(import.meta.dirname, '../../../../v2.8/schema/metamodel.schema.yaml');

/**
 * The rename, with its negative half first.
 *
 * A greedy rewrite is worse than none: it turns `DSC001` into `DCSC001` and nothing complains
 * until a reference stops resolving months later. So the fixture leads with every id that shares a
 * first letter with a retired band and must survive untouched, and only then asserts the rewrites.
 */
const NEVER_TOUCHED = [
  'DSC001', 'DR001', 'DEC001', 'DC001',
  'RT001', 'RES001', 'RL001', 'RSK001',
  'TC001', 'TR001', 'TRO001',
  'ACT001', 'ASM001', 'ASC001', 'GL001',
  'D0011', 'orders.DSC001',
  // From the corpus rather than imagined: a garage-door model number in a sibling schema's prose.
  // Without the right anchor, `\\bA\\d{3}` matches the `A350` inside it and rewrites a product name.
  'A3500',
];

const MOTIVATION = `version: "1.0.0"
scope: orders
goals:
  - id: orders.G001
    statement: "Ship the same day"
risks:
  - id: orders.R001
    statement: "Stock sold twice"
    goal_refs: [orders.G001]
assumptions:
  - id: orders.A001
    statement: "Payment settles within a day"
trade_offs:
  - id: orders.T001
    statement: "Latency against consistency"
`;

const DECISIONS = `version: "1.0.0"
scope: orders
decisions:
  - id: orders.D001
    title: "Reserve stock on order placed"
    # DSC001 is a deployment scope and DR001 a derivation rule - neither is a decision.
    scope_ref: shared.DSC001
    rule_refs: [orders.DR001]
    goal_refs: [orders.G001, G002]
`;

const CONCEPTS = `version: "1.0.0"
scope: orders
associations:
  - id: orders.AS001
    name: "Order to Customer"
actors:
  - id: orders.ACT001
    name: Customer
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-bands-'));
  fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders', 'motivation.yaml'), MOTIVATION, 'utf8');
  fs.writeFileSync(path.join(dir, 'orders', 'decisions.yaml'), DECISIONS, 'utf8');
  fs.writeFileSync(path.join(dir, 'orders', 'concepts.yaml'), CONCEPTS, 'utf8');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (relative: string): string => fs.readFileSync(path.join(dir, relative), 'utf8');

describe('006 retire the one-letter bands - what must NOT change', () => {
  it.each(NEVER_TOUCHED)('leaves %s exactly as it found it', (id) => {
    expect(rebandText(`ref: ${id}\n`).text).toBe(`ref: ${id}\n`);
  });

  it('is a real control - the same function does rewrite the ids it is for', () => {
    // Without this, every assertion above would pass on a function that rewrites nothing.
    expect(rebandText('ref: D001\n').text).toBe('ref: DC001\n');
    expect(rebandText('ref: AS001\n').text).toBe('ref: ASC001\n');
  });
});

describe('006 retire the one-letter bands', () => {
  it('rewrites all six bands, bare and context-qualified', () => {
    expect(update.apply(dir).applied).toBe(true);
    const motivation = read('orders/motivation.yaml');
    expect(motivation).toContain('id: orders.GL001');
    expect(motivation).toContain('id: orders.RSK001');
    expect(motivation).toContain('id: orders.ASM001');
    expect(motivation).toContain('id: orders.TRO001');
    expect(motivation).toContain('goal_refs: [orders.GL001]');
    expect(read('orders/decisions.yaml')).toContain('id: orders.DC001');
    expect(read('orders/decisions.yaml')).toContain('goal_refs: [orders.GL001, GL002]');
    expect(read('orders/concepts.yaml')).toContain('id: orders.ASC001');
  });

  it('leaves the longer bands beside them alone, in the file that mixes them', () => {
    update.apply(dir);
    const decisions = read('orders/decisions.yaml');
    expect(decisions).toContain('scope_ref: shared.DSC001');
    expect(decisions).toContain('rule_refs: [orders.DR001]');
    expect(decisions).not.toContain('DCSC001');
    expect(read('orders/concepts.yaml')).toContain('id: orders.ACT001');
  });

  it('counts what it rewrote, per band, in the plan', () => {
    const plan = update.plan(dir);
    const detail = plan.changes.map((change) => `${change.path}: ${change.detail}`).join('\n');
    expect(detail).toContain('orders/decisions.yaml: 1 D### -> DC###');
    expect(detail).toContain('orders/concepts.yaml: 1 AS### -> ASC###');
  });

  it('plans nothing on a second run - the control, because a chain may re-run it', () => {
    update.apply(dir);
    expect(update.plan(dir).changes).toEqual([]);
  });

  it('names a README still carrying a retired band rather than rewriting it', () => {
    fs.writeFileSync(path.join(dir, 'orders', 'README.md'), 'The decision D001 explains why.\n', 'utf8');
    expect(update.plan(dir).warnings.join('\n')).toContain('README.md: 1 id(s) in prose');
    update.apply(dir);
    expect(read('orders/README.md')).toContain('D001');
  });

  it('the modules between them retire exactly the bands the schema retires', () => {
    // The UNION, because a band may be retired by whichever module suits its rewrite: `006` sweeps
    // text for the six that are referenced across layers, `010` edits one structural site for the
    // one that is referenced by nothing. What must hold is that no band is retired by the schema
    // with no module to move a model onto it.
    const here = [...BAND_RENAMES, ...WATCH_RENAMES].map(([from, to]) => `${from}->${to}`).sort();
    const declared = YAML.parse(fs.readFileSync(METAMODEL, 'utf8'))['x-retired-bands'];
    const canonical = declared.bands
      .map((band: { old: string; new: string }) => `${band.old}->${band.new}`)
      .sort();
    expect(here).toEqual(canonical);
  });
});
