import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './007-story-becomes-process.js';

/**
 * The rename as a migration, on a model written the way the corpus writes one.
 *
 * The fixture carries every case the module has to tell apart in one file: the entity being
 * renamed, the `user_story` beside it that must not move, the nested `process` block with an
 * `SP###` id, an activity band, a comment above a promoted key, and a reference to the entity from
 * another file. The negative control is the model run twice - a module that is not idempotent is
 * unsafe in a chain that may be re-run, and a second pass planning nothing is what says so.
 */
const STORY_YAML = `name: "Order Stories"
version: "1.0.0"
scope: orders

stories:
  - id: orders.STR001
    title: "Place an order"
    storyUri: "https://tracker/ORD-1"
    process:
      id: orders.SP001
      # The event that starts it.
      trigger:
        type: message
        operation: orders.CMD001
      end_states:
        - name: "Placed"
          type: complete
      lanes:
        - actor: orders.ACT001
          operations: [orders.CMD001]
    activities:
      - id: orders.SA001
        name: "Take the order"
        entry_operation: orders.CMD001
        next_activities: [orders.SA002]
      - id: orders.SA002
        name: "Reserve stock"
        entry_operation: orders.CMD002

user_stories:
  - id: orders.US001
    actor: orders.ACT001
    goal: "place an order"

use_cases:
  - id: orders.UC001
    name: "Order placement"
    primary_actor: orders.ACT001
    user_stories: [orders.US001]
    stories: [orders.STR001]
`;

const MOTIVATION_YAML = `name: Orders
version: "1.0.0"
goals:
  - id: orders.G001
    statement: "Ship the same day"
    affects:
      story_refs: [orders.STR001]
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-to-process-'));
  fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders', 'story.yaml'), STORY_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'orders', 'motivation.yaml'), MOTIVATION_YAML, 'utf8');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function read(relative: string): string {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

describe('007 story becomes process', () => {
  it('plans an edit for the narrative file and for the file that references it, and moves neither', () => {
    const plan = update.plan(dir);
    const paths = plan.changes.map((change) => `${change.type} ${change.path}`);
    expect(paths).toContain('edit-yaml orders/story.yaml');
    expect(paths).toContain('edit-yaml orders/motivation.yaml');
    // The entity is renamed and the FILE is not. A narrative file declares `user_story` and
    // `use_case` beside the entity this renames, so naming it after the renamed one would name it
    // after a fraction of what it holds - and both spellings load on every line from 2.6.
    expect(plan.changes.every((change) => change.type !== 'rename-file')).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it('renames the bands and leaves the user story alone', () => {
    expect(update.apply(dir).applied).toBe(true);
    const text = read('orders/story.yaml');
    expect(text).toContain('id: orders.PRC001');
    expect(text).toContain('id: orders.PA001');
    expect(text).toContain('next_activities: [orders.PA002]');
    expect(text).toContain('id: orders.US001');
    expect(text).toContain('user_stories: [orders.US001]');
    expect(text).not.toMatch(/\b(STR|SA|SP)\d{3}\b/);
  });

  it('flattens the process block, drops the SP id, and keeps the comment above the promoted key', () => {
    update.apply(dir);
    const text = read('orders/story.yaml');
    expect(text).toContain('    trigger:\n      type: message');
    expect(text).toContain('    end_states:');
    expect(text).toContain('    lanes:');
    expect(text).toContain('    # The event that starts it.');
    expect(text).not.toContain('process:\n');
    expect(text).not.toContain('SP001');
  });

  it('renames the collection keys the entity is named in, in both files', () => {
    update.apply(dir);
    expect(read('orders/story.yaml')).toContain('\nprocesses:\n');
    expect(read('orders/story.yaml')).toContain('    processes: [orders.PRC001]');
    expect(read('orders/story.yaml')).toContain('    processUri:');
    expect(read('orders/motivation.yaml')).toContain('      process_refs: [orders.PRC001]');
  });

  it('leaves the file where it was, under the name it had', () => {
    update.apply(dir);
    expect(fs.existsSync(path.join(dir, 'orders', 'story.yaml'))).toBe(true);
    // The control: if the module still moved files, THIS is where the content would be.
    expect(fs.existsSync(path.join(dir, 'orders', 'process.yaml'))).toBe(false);
    // And the file it left behind carries the migrated content, not the old.
    expect(read('orders/story.yaml')).toContain('\nprocesses:\n');
  });

  it('plans nothing on a second run - the control, because a chain may re-run it', () => {
    update.apply(dir);
    const second = update.plan(dir);
    expect(second.changes).toEqual([]);
    expect(second.warnings).toEqual([]);
  });

  it('refuses a flow-style process block, naming it rather than half-renaming around it', () => {
    fs.writeFileSync(
      path.join(dir, 'orders', 'story.yaml'),
      'stories:\n  - id: orders.STR009\n    process: { id: orders.SP009, trigger: { type: manual } }\n',
      'utf8',
    );
    const plan = update.plan(dir);
    expect(plan.warnings.join('\n')).toContain('flow-style `process:`');
  });
});

describe('a change program classifies the entities it touches', () => {
  it("moves `entity_type` onto the vocabulary this rename introduces, and leaves relation names alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-entity-type-'));
    fs.mkdirSync(path.join(dir, '.migrations'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.migrations', 'MIG001-split.migration.yaml'),
      [
        'schemaVersion: "2.6.0"',
        'migration:',
        '  id: MIG001',
        'changes:',
        '  entities:',
        '    - kind: add',
        '      entity_type: story',
        '      target: orders.STR002',
        '    - kind: modify',
        '      entity_type: activity   # the step inside it',
        '      target: orders.SA010',
        '  relations:',
        '    - kind: add',
        '      relation_type: screen_story',
        '',
      ].join('\n'),
      'utf8',
    );
    update.apply(dir);
    const text = fs.readFileSync(path.join(dir, '.migrations', 'MIG001-split.migration.yaml'), 'utf8');

    expect(text).toContain('entity_type: process\n');
    expect(text).toContain('entity_type: process-activity   # the step inside it');
    expect(text).toContain('target: orders.PRC002');
    expect(text).toContain('target: orders.PA010');
    // The relation vocabulary did not move with the entity one.
    expect(text).toContain('relation_type: screen_story');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
