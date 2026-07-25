// @ts-check
/**
 * Integration tests over a synthetic model built from the SHAPES that actually broke
 * in the stress test — undescribed `one_of` counterpart events, `summary`-bearing
 * actors, map-form collections, prefixed ids, filler prose — plus the mechanics the
 * gate depends on: patch scoping, the ratchet, and deferral validation.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectObservations } from './collect.mjs';
import { evaluate, nextBaseline } from './evaluate.mjs';
import { loadSpec } from './config.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(TOOL_DIR, 'cli.mjs');

/** @type {string} */
let fixtureRoot;

const FIXTURE_FILES = {
  'blueprint.yaml': `
schemaVersion: "2.7.0"
name: fixture
`,
  // Map-form operations with an undescribed `one_of` failure counterpart — the exact
  // asymmetry observed in the stress test (happy path described, failure half bare).
  'shop/domain.yaml': `
schemaVersion: "2.7.0"
operations:
  PlaceOrder:
    id: shop.C001
    kind: command
    description: "Places a customer order and reserves stock."
    produces: shop.E001
    exchange: { channel: orders }
  OrderPlaced:
    id: shop.E001
    kind: event
    description: "Emitted once an order is durably persisted and stock reserved."
  OrderRejected:
    id: shop.E002
    kind: event
errors:
  StockUnavailable:
    id: shop.ER01
    description: "Raised when reserved stock falls below the requested quantity."
`,
  // Actors carry prose under `summary`, not `description` (plan D11). Treating
  // `description` as the only carrier would report these as gaps.
  'shop/concepts.yaml': `
schemaVersion: "2.7.0"
concepts:
  - id: shop.CN001
    term: Order
    description: "A customer's confirmed intent to purchase, priced and payable."
    attributes:
      total:
        description: "Order grand total in the order's settlement currency."
        example: 42.5
      status:
        description: "The status field."
actors:
  - id: shop.AC01
    name: Shopper
    summary: "A person buying goods through the storefront checkout."
`,
  'shop/models.yaml': `
schemaVersion: "2.7.0"
components:
  schemas:
    PlaceOrderPayload:
      description: "Wire payload accepted by the PlaceOrder command endpoint."
      purpose: command-payload
      represents: [{ concept_ref: shop.CN001 }]
      type: object
      properties:
        orderId:
          type: string
          description: "Stable identifier assigned to the order at placement."
          example: "ord_10233"
        criteria:
          type: string
          description: "The criteria field."
        note:
          type: string
        currency:
          type: string
          enum: [PLN, EUR]
          description: "TODO"
`,
  'shop/rules.yaml': `
schemaVersion: "2.7.0"
validation:
  - id: shop.RL01
    statement: "An order must contain at least one line item to be placeable."
`,
  'shop/test-cases.yaml': `
schemaVersion: "2.7.0"
happy_path:
  - id: shop.TC01
    name: Places an order
    summary: "A shopper with a valid cart places an order and receives confirmation."
    provenance: { origin: authored }
`,
  // A typed entity no specific collector claims — the safety net must still see it.
  'shop/leverage.yaml': `
schemaVersion: "2.7.0"
leverage_points:
  - id: shop.LP01
    title: Checkout latency
`,
};

before(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-quality-'));
  for (const [relativePath, content] of Object.entries(FIXTURE_FILES)) {
    const target = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
});

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

/** @param {string[]} args */
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? -1, stdout: String(error.stdout ?? '') + String(error.stderr ?? '') };
  }
}

function scoreOf(result, metricId) {
  const metric = result.metrics.find((candidate) => candidate.id === metricId);
  assert.ok(metric, `metric ${metricId} missing from result`);
  return metric;
}

describe('collection — the shapes that broke in the stress test', () => {
  test('finds the undescribed `one_of` counterpart event', () => {
    const { observations } = collectObservations(fixtureRoot);
    const events = observations.filter((observation) => observation.metric === 'domain.event.description');
    assert.equal(events.length, 2, 'both halves of the one_of pair must be observed');
    const bare = events.find((observation) => observation.subject === 'OrderRejected');
    assert.equal(bare?.value, undefined, 'the failure counterpart has no description');
  });

  test('an actor documented via `summary` counts as covered (D11)', () => {
    const { observations } = collectObservations(fixtureRoot);
    const actor = observations.find((observation) => observation.metric === 'concept.actor.description');
    assert.ok(String(actor?.value).includes('buying goods'), 'summary must be read as the prose carrier');
  });

  test('map-form collections are collected and keep their key as the subject name', () => {
    const { observations } = collectObservations(fixtureRoot);
    const operations = observations.filter((observation) => observation.metric === 'domain.operation.description');
    assert.deepEqual(operations.map((observation) => observation.subject).sort(), ['OrderPlaced', 'OrderRejected', 'PlaceOrder']);
  });

  test('scope-prefixed typed ids are recognised', () => {
    const { observations } = collectObservations(fixtureRoot);
    const withIds = observations.filter((observation) => observation.entityId);
    assert.ok(withIds.some((observation) => observation.entityId === 'shop.CN001'));
  });

  test('rules under a category key and test cases under a scenario key are found', () => {
    const { observations } = collectObservations(fixtureRoot);
    assert.equal(observations.filter((o) => o.metric === 'rule.description').length, 1);
    assert.equal(observations.filter((o) => o.metric === 'test_case.description').length, 1);
  });

  test('safety net catches a typed entity no specific collector claims', () => {
    const { observations } = collectObservations(fixtureRoot);
    const unclaimed = observations.filter((observation) => observation.metric === 'entity.description');
    assert.ok(unclaimed.some((observation) => observation.entityId === 'shop.LP01'),
      'an unrecognised entity kind must still be measured, not silently dropped');
  });

  test('claimed entities are not double-counted by the safety net', () => {
    const { observations } = collectObservations(fixtureRoot);
    const unclaimed = observations.filter((observation) => observation.metric === 'entity.description');
    assert.ok(!unclaimed.some((observation) => observation.entityId === 'shop.CN001'),
      'a concept is measured by concept.description, not twice');
  });

  test('takes the highest declared schemaVersion across the model', () => {
    const { schemaVersion } = collectObservations(fixtureRoot);
    assert.equal(schemaVersion, '2.7.0');
  });
});

describe('evaluation — missing vs filler', () => {
  test('separates filler from genuinely missing property descriptions', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = collectObservations(fixtureRoot);
    const result = evaluate({ observations, spec, schemaVersion });
    const metric = scoreOf(result, 'model.property.description');

    assert.equal(metric.total, 4, 'orderId, criteria, note, currency');
    assert.equal(metric.covered, 1, 'only orderId is substantive');
    assert.equal(metric.filler, 2, '"The criteria field." echoes the name; "TODO" is a placeholder');
    assert.equal(metric.missing, 1, 'note has no description at all');
  });

  test('filler is reported with the reason that condemned it', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = collectObservations(fixtureRoot);
    const result = evaluate({ observations, spec, schemaVersion });
    const echo = result.findings.find((finding) => finding.subject === 'PlaceOrderPayload.criteria');
    assert.equal(echo?.status, 'filler');
    assert.match(String(echo?.reason), /restates/);
  });
});

describe('patch mode — the brownfield mechanism', () => {
  test('scores only entities in changed files, using the higher patch bar', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = collectObservations(fixtureRoot);
    const changedFiles = new Set([path.join(fixtureRoot, 'shop', 'domain.yaml')]);

    const whole = evaluate({ observations, spec, schemaVersion });
    const patch = evaluate({ observations, spec, changedFiles, schemaVersion });

    assert.ok(scoreOf(whole, 'model.property.description').total > 0);
    assert.equal(scoreOf(patch, 'model.property.description').total, 0,
      'models.yaml did not change, so its properties are out of scope');
    assert.equal(scoreOf(patch, 'domain.event.description').total, 2);
    assert.equal(scoreOf(patch, 'domain.event.description').threshold, 1,
      'patch mode uses patch_threshold (1.0), not the whole-model bar (0.9)');
  });

  test('the ratchet does not fire in patch mode', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = collectObservations(fixtureRoot);
    const config = { baseline: { 'domain.event.description': 0.99 } };
    const changedFiles = new Set([path.join(fixtureRoot, 'shop', 'domain.yaml')]);

    const whole = evaluate({ observations, spec, config, schemaVersion });
    const patch = evaluate({ observations, spec, config, changedFiles, schemaVersion });

    assert.equal(scoreOf(whole, 'domain.event.description').status, 'below-baseline');
    assert.notEqual(scoreOf(patch, 'domain.event.description').status, 'below-baseline',
      'a whole-model ratchet must not be judged against a changed-file subset');
  });
});

describe('baseline ratchet', () => {
  test('records current scores and never lowers an existing floor', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = collectObservations(fixtureRoot);
    const result = evaluate({ observations, spec, schemaVersion });

    const fresh = nextBaseline(result, {});
    assert.ok(fresh['model.property.description'] > 0);

    const withHigherFloor = nextBaseline(result, { 'model.property.description': 0.99 });
    assert.equal(withHigherFloor['model.property.description'], 0.99,
      'a ratchet only turns one way — a bad run must not license the regression it caused');
  });
});

describe('deferrals', () => {
  const baseObservations = () => collectObservations(fixtureRoot);

  test('a valid deferral suppresses the gate but stays in the report', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = baseObservations();
    const config = {
      deferrals: [{ metric: 'model.property.description', reason: 'backfill scheduled', expires: '2099-01-01' }],
    };
    const result = evaluate({ observations, spec, config, schemaVersion });
    const metric = scoreOf(result, 'model.property.description');
    assert.equal(metric.status, 'deferred');
    assert.equal(metric.total, 4, 'still measured and reported');
    assert.ok(!result.breaches.some((breach) => breach.id === 'model.property.description'));
  });

  test('a deferral without a reason is a configuration error', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = baseObservations();
    const config = { deferrals: [{ metric: 'model.property.description', expires: '2099-01-01' }] };
    const result = evaluate({ observations, spec, config, schemaVersion });
    assert.match(result.configErrors.join(' '), /has no reason/);
  });

  test('a deferral without an expiry is a configuration error', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = baseObservations();
    const config = { deferrals: [{ metric: 'model.property.description', reason: 'later' }] };
    const result = evaluate({ observations, spec, config, schemaVersion });
    assert.match(result.configErrors.join(' '), /has no "expires"/);
  });

  test('an expired deferral warns loudly but does not fail the build', () => {
    const { spec } = loadSpec();
    const { observations, schemaVersion } = baseObservations();
    const config = {
      deferrals: [{ metric: 'model.property.description', reason: 'overdue', expires: '2020-01-01' }],
    };
    const result = evaluate({ observations, spec, config, schemaVersion, now: new Date('2026-07-25') });
    assert.match(result.warnings.join(' '), /expired on 2020-01-01/);
    assert.equal(scoreOf(result, 'model.property.description').status, 'deferred');
  });
});

describe('CLI contract', () => {
  test('default mode reports without failing', () => {
    const { code, stdout } = runCli([fixtureRoot]);
    assert.equal(code, 0);
    assert.match(stdout, /model\.property\.description/);
  });

  test('--strict exits 1 when a threshold is breached', () => {
    const { code } = runCli([fixtureRoot, '--strict', '--quiet']);
    assert.equal(code, 1);
  });

  test('--json emits per-finding records usable as a worklist', () => {
    const { code, stdout } = runCli([fixtureRoot, '--json']);
    assert.equal(code, 0);
    const payload = JSON.parse(stdout);
    const [run] = payload.runs;
    assert.ok(Array.isArray(run.findings));
    const finding = run.findings.find((candidate) => candidate.subject === 'PlaceOrderPayload.note');
    assert.equal(finding.status, 'missing');
    assert.equal(finding.file, path.join('shop', 'models.yaml'));
    assert.ok(run.metrics.length > 0);
  });

  test('an unknown option exits 2 rather than scanning something unintended', () => {
    assert.equal(runCli([fixtureRoot, '--nope']).code, 2);
  });

  test('a missing model root exits 2', () => {
    assert.equal(runCli([path.join(fixtureRoot, 'does-not-exist')]).code, 2);
  });

  test('--since cannot be combined with --update-baseline', () => {
    const { code, stdout } = runCli([fixtureRoot, '--since', 'HEAD', '--update-baseline']);
    assert.equal(code, 2);
    assert.match(stdout, /cannot be combined/);
  });
});
