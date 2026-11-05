import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './012-next-branches.js';

/**
 * The successor migration on a model written the way the corpus writes one.
 *
 * The fixture carries every case the module has to tell apart: a lone successor, a fork, a block
 * list, a comment above a migrated key, and a file already on the new spelling. The negative
 * control is the model run twice - a module that is not idempotent is unsafe in a chain that may
 * be re-run, and a second pass planning nothing is what says so.
 */
const STORY_YAML = `name: "Order Processes"
version: "1.0.0"
scope: orders

processes:
  - id: orders.PRC001
    activities:
      - id: orders.PA001
        name: "Take the order"
        # Where it goes when the order is taken.
        next_activities: [orders.PA002]
      - id: orders.PA002
        name: "Decide on payment"
        next_activities: [orders.PA003, orders.PA004]
      - id: orders.PA003
        name: "Ship"
        next_activities:
          - orders.PA005
      - id: orders.PA004
        name: "Refund"
        next_activities: []
      - id: orders.PA005
        name: "Close"
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-branches-'));
  fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders', 'story.yaml'), STORY_YAML, 'utf8');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function read(relative: string): string {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

describe('012 next_activities becomes next', () => {
  it('leaves a lone successor on its line, because a condition there chooses nothing', () => {
    update.apply(dir);
    expect(read('orders/story.yaml')).toContain('next: [{to: orders.PA002}]');
  });

  it('expands a fork to block style, which is where a condition will go', () => {
    update.apply(dir);
    const text = read('orders/story.yaml');
    expect(text).toContain('        next:\n          - to: orders.PA003\n          - to: orders.PA004\n');
  });

  it('migrates a block list too, one `to:` per item', () => {
    update.apply(dir);
    expect(read('orders/story.yaml')).toContain('        next:\n          - to: orders.PA005\n');
  });

  it('invents no condition, because the older key carried none', () => {
    update.apply(dir);
    expect(read('orders/story.yaml')).not.toContain('condition');
  });

  it('leaves the author\'s comment where the author put it', () => {
    update.apply(dir);
    const text = read('orders/story.yaml');
    expect(text).toContain('        # Where it goes when the order is taken.\n        next: [{to: orders.PA002}]');
  });

  it('retires the old key entirely', () => {
    update.apply(dir);
    expect(read('orders/story.yaml')).not.toContain('next_activities');
  });

  it('carries an empty list over rather than leaving the superseded key behind', () => {
    // Skipping it would leave 10 activities in this corpus still warning after a run that
    // reported success. An empty `next` reads as the empty `next_activities` did: every consumer
    // treats an empty successor list and an absent one alike.
    update.apply(dir);
    expect(read('orders/story.yaml')).toContain('next: []');
  });

  it('plans nothing on a second pass, so it is safe inside a chain that re-runs', () => {
    update.apply(dir);
    const second = update.plan(dir);
    expect(second.changes).toEqual([]);
    expect(second.warnings).toEqual([]);
  });

  it('keeps CRLF where the file had it', () => {
    const crlf = path.join(dir, 'orders', 'crlf.yaml');
    fs.writeFileSync(crlf, 'activities:\r\n  - id: orders.PA009\r\n    next_activities: [orders.PA010]\r\n', 'utf8');
    update.apply(dir);
    const text = fs.readFileSync(crlf, 'utf8');
    expect(text).toContain('next: [{to: orders.PA010}]\r\n');
    expect(text).not.toContain('next: [{to: orders.PA010}]\n\n');
  });

  it('refuses a file where an activity would end up declaring `next` twice, and leaves it alone', () => {
    // The schema says an activity declares one key or the other and never both. Writing the second
    // would produce a document the validator rejects, which is worse than stopping and saying so.
    const both = path.join(dir, 'orders', 'both.yaml');
    const source = 'activities:\n  - id: orders.PA020\n    next: [{to: orders.PA021}]\n    next_activities: [orders.PA022]\n';
    fs.writeFileSync(both, source, 'utf8');
    const plan = update.plan(dir);
    expect(plan.warnings.join(' ')).toContain('declare `next` twice');
    update.apply(dir);
    expect(fs.readFileSync(both, 'utf8')).toBe(source);
  });

  it('names a guide that still mentions the old key rather than rewriting its prose', () => {
    fs.writeFileSync(path.join(dir, 'orders', 'README.md'), 'Author `next_activities` on each step.\n', 'utf8');
    const plan = update.plan(dir);
    expect(plan.warnings.join(' ')).toContain('next_activities` in prose');
  });
});
