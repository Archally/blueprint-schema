// @ts-check
/**
 * The structure signals: does an entity state its facts in fields, or only in prose?
 *
 * Three signals, report-only: references held only in prose (ids a description or a rule's logic
 * names that no other field of the same entity names, resolved against the ids the model
 * declares), the fields an entity uses out of those its schema type makes available, and the
 * description's length as context. The fixture carries its own schema tree, so the available set
 * is the fixture's and not whatever schema the checkout holds.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { locateSchemaRoot, loadSchemaIndex, resolverFor, measureStructure } from './structure.mjs';
import { collectObservations } from './collect.mjs';
import { loadSpec } from './config.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(TOOL_DIR, 'cli.mjs');

const SCHEMA_FILES = {
  'metamodel.schema.yaml': `
$defs:
  concept_ref:
    type: string
    pattern: "^([a-z][a-z0-9-]*\\\\.)?CN\\\\d{3}$"
  rule_ref:
    type: string
    pattern: "^([a-z][a-z0-9-]*\\\\.)?(SR|VR)\\\\d{3}$"
  user_story_ref:
    type: string
    pattern: "^([a-z][a-z0-9-]*\\\\.)?US\\\\d{3,}$"
  tags:
    type: array
    items: { type: string }
`,
  'design/rules.schema.yaml': `
properties:
  validation:
    type: array
    items: { $ref: "#/$defs/rule" }
$defs:
  rule:
    type: object
    properties:
      id: { type: string }
      name: { type: string }
      description: { type: string }
      summary: { type: string }
      logic: { type: string }
      modality: { type: string }
      concepts:
        type: array
        items: { $ref: "../metamodel.schema.yaml#/$defs/concept_ref" }
      code_refs: { type: array }
      provenance: { type: object }
      examples: { type: array }
      on_violation: { type: object }
`,
  'design/concepts.schema.yaml': `
properties:
  concepts:
    type: array
    items: { $ref: "#/$defs/concept" }
$defs:
  concept:
    type: object
    properties:
      id: { type: string }
      name: { type: string }
      description: { type: string }
      attributes: { type: object }
`,
  'governance/decisions.schema.yaml': `
properties:
  decisions:
    type: array
    items: { $ref: "#/$defs/decision" }
  business_decisions:
    type: array
    items: { $ref: "#/$defs/business_decision" }
$defs:
  decision:
    type: object
    properties:
      id: { type: string }
      title: { type: string }
      summary: { type: string }
      declared_impact:
        type: object
        properties:
          rules:
            type: array
            items: { $ref: "../metamodel.schema.yaml#/$defs/rule_ref" }
  business_decision:
    type: object
    properties:
      id: { type: string }
      name: { type: string }
      description: { type: string }
      domain_scope: { type: string }
      linked_user_stories:
        type: array
        items: { $ref: "../metamodel.schema.yaml#/$defs/user_story_ref" }
      tags: { $ref: "../metamodel.schema.yaml#/$defs/tags" }
      code_refs: { type: array }
`,
};

const MODEL_FILES = {
  'blueprint.yaml': `
schemaVersion: "2.8.0"
name: demo
`,
  'shop/concepts.yaml': `
schemaVersion: "2.8.0"
concepts:
  - id: shop.CN001
    name: Order
    description: "A customer's confirmed intent to purchase, priced and payable."
  - id: shop.CN002
    name: Stock
    description: "The quantity of a product the shop can still promise to a customer."
`,
  'shop/rules.yaml': `
schemaVersion: "2.8.0"
validation:
  - id: shop.VR001
    name: Order total is positive
    description: "An order's total stays above zero; the Order is shop.CN001."
    modality: necessary
    concepts: [shop.CN001]
  - id: shop.VR002
    name: A refund never exceeds what was paid
    description: "A refund is capped at the amount paid, in its ISO4217 currency; XX000 is a placeholder."
    logic: "refund.amount <= payment.amount"
    code_refs:
      - path: src/Refund.php
    provenance:
      certainty: confirmed
  - id: shop.VR003
    name: Stock is reserved before payment
    description: "Payment starts only once the order's lines hold their stock (CN002)."
    concepts: []
`,
  'decisions.yaml': `
schemaVersion: "2.8.0"
decisions:
  - id: DC001
    title: Orders are priced once
    summary: "An order's price is fixed when it is placed."
business_decisions:
  - id: BD001
    name: An order is priced once and checked once
    description: "BD001 rests on shop.VR001 and on DC001; nothing re-prices a placed order."
    domain_scope: shop
    tags: [pricing]
`,
};

/** @param {string} root @param {Record<string,string>} files */
function writeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content.trimStart());
  }
}

/** @type {string} */
let workspace;
/** @type {string} */
let modelRoot;
/** @type {string} */
let schemaBase;

before(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-quality-structure-'));
  schemaBase = path.join(workspace, 'schemas', 'blueprint');
  writeTree(path.join(schemaBase, 'v2.8', 'schema'), SCHEMA_FILES);
  modelRoot = path.join(workspace, 'projects', 'demo', '.blueprint', 'v2.8');
  writeTree(modelRoot, MODEL_FILES);
});

after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

/** @param {string[]} args */
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? -1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
  }
}

/** @param {string} id */
function entityJson(id) {
  const { code, stdout, stderr } = runCli([modelRoot, '--entity', id, '--json']);
  assert.equal(code, 0, stderr);
  const [run] = JSON.parse(stdout).runs;
  const [entity] = run.entities;
  assert.equal(entity.entityId, id);
  return { run, entity };
}

describe('references held only in prose', () => {
  test('a business decision naming two ids in prose and none in a field reports both, each as a schema gap', () => {
    const { entity } = entityJson('BD001');
    assert.deepEqual(
      entity.structure.proseOnlyReferences.map((reference) => [reference.id, reference.schemaHasField]),
      [['shop.VR001', false], ['DC001', false]],
    );
  });

  test('the entity\'s own id in its description is not a reference', () => {
    const { entity } = entityJson('BD001');
    assert.ok(!entity.structure.proseOnlyReferences.some((reference) => reference.id === 'BD001'));
  });

  test('an id the prose names and the concepts field also names is not reported', () => {
    const { entity } = entityJson('shop.VR001');
    assert.deepEqual(entity.structure.proseOnlyReferences, []);
  });

  test('a token shaped like an id that the model does not declare is ignored', () => {
    const { entity } = entityJson('shop.VR002');
    assert.deepEqual(entity.structure.proseOnlyReferences, []);
  });

  test('an unscoped id resolves to the declared id in the entity\'s own slice, and names the field that could hold it', () => {
    const { entity } = entityJson('shop.VR003');
    assert.deepEqual(entity.structure.proseOnlyReferences, [
      { id: 'shop.CN002', written: 'CN002', in: 'description', schemaHasField: true, fields: ['concepts'] },
    ]);
  });
});

describe('fields used against those the schema type makes available', () => {
  test('a rule with logic, code_refs and provenance uses 3 of the type\'s 7 non-identity, non-prose fields', () => {
    const { entity } = entityJson('shop.VR002');
    assert.deepEqual(entity.structure.fieldsUsed, ['logic', 'code_refs', 'provenance']);
    assert.equal(entity.structure.fieldsAvailable, 7);
    assert.equal(entity.structure.type, 'rule');
  });

  test('an empty list is not a field used', () => {
    const { entity } = entityJson('shop.VR003');
    assert.deepEqual(entity.structure.fieldsUsed, []);
  });

  test('the business decision uses domain_scope and tags of its 4 available fields', () => {
    const { entity } = entityJson('BD001');
    assert.deepEqual(entity.structure.fieldsUsed, ['domain_scope', 'tags']);
    assert.equal(entity.structure.fieldsAvailable, 4);
  });

  test('the description length is carried as context', () => {
    const { entity } = entityJson('BD001');
    assert.equal(entity.structure.descriptionLength, MODEL_FILES['decisions.yaml'].match(/description: "([^"]*)"/)?.[1].length);
  });
});

describe('the whole-model report counts per kind', () => {
  test('--json carries one row per measured container with the reference and field counts', () => {
    const { code, stdout } = runCli([modelRoot, '--json']);
    assert.equal(code, 0);
    const [run] = JSON.parse(stdout).runs;
    assert.equal(run.structure.schemaRoot, path.join(schemaBase, 'v2.8'));
    const byKind = Object.fromEntries(run.structure.kinds.map((kind) => [kind.kind, kind]));
    assert.deepEqual(
      [byKind.business_decisions.entities, byKind.business_decisions.withProseOnlyReferences, byKind.business_decisions.proseOnlyReferences, byKind.business_decisions.schemaGapReferences],
      [1, 1, 2, 2],
    );
    assert.deepEqual(
      [byKind.validation.entities, byKind.validation.withProseOnlyReferences, byKind.validation.proseOnlyReferences, byKind.validation.schemaGapReferences],
      [3, 1, 1, 0],
    );
    assert.equal(byKind.validation.fieldsAvailable, 7);
    assert.deepEqual(byKind.validation.fieldsUsed.distribution, { 0: 1, 2: 1, 3: 1 });
  });

  test('entity mode scopes the per-kind rows to the selected entity', () => {
    const { run } = entityJson('BD001');
    assert.deepEqual(run.structure.kinds.map((kind) => [kind.kind, kind.entities]), [['business_decisions', 1]]);
  });

  test('the structure signals add no metric, so thresholds and exit codes stay where they were', () => {
    const { stdout } = runCli([modelRoot, '--json']);
    const [run] = JSON.parse(stdout).runs;
    const { spec } = loadSpec();
    assert.deepEqual(run.metrics.map((metric) => metric.id), Object.keys(spec.metrics));
  });

  test('the text report prints the per-kind table and the entities with references held only in prose', () => {
    const { code, stdout } = runCli([modelRoot]);
    assert.equal(code, 0);
    assert.match(stdout, /Structure - facts in fields or only in prose/);
    assert.match(stdout, /business_decisions \(business_decision\)\s+1\s+1\s+2\s+2/);
    assert.match(stdout, /BD001 .*shop\.VR001, DC001/);
  });

  test('the entity block names each reference and says when the schema has no field for it', () => {
    const { stdout } = runCli([modelRoot, '--entity', 'BD001']);
    assert.match(stdout, /fields used: 2 of 4 \(domain_scope, tags\); description \d+ chars/);
    assert.match(stdout, /held only in prose\s+shop\.VR001\s+the schema has no field for this/);
    const rule = runCli([modelRoot, '--entity', 'shop.VR003']).stdout;
    assert.match(rule, /held only in prose\s+shop\.CN002\s+a field can hold it: concepts/);
  });
});

describe('where the schema comes from', () => {
  test('without --schemas the gate finds the version root by walking up from the model', () => {
    const located = locateSchemaRoot({ schemaVersion: '2.8.0', modelRoot, toolDir: workspace, cwd: workspace, env: {} });
    assert.equal(located.root, path.join(schemaBase, 'v2.8'));
  });

  test('--schemas accepts a directory of versions or a version root', () => {
    for (const explicit of [schemaBase, path.join(schemaBase, 'v2.8')]) {
      const located = locateSchemaRoot({ explicit, schemaVersion: '2.8.0', modelRoot: workspace, toolDir: workspace, cwd: workspace, env: {} });
      assert.equal(located.root, path.join(schemaBase, 'v2.8'));
    }
  });

  test('--schemas naming a directory without the model\'s version refuses with exit 2', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-quality-noschema-'));
    try {
      const { code, stderr } = runCli([modelRoot, '--schemas', empty]);
      assert.equal(code, 2);
      assert.match(stderr, /--schemas \S+ holds no v2\.8 schema directory/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('no schema found leaves the available set unknown and still reports prose-only references', () => {
    const located = locateSchemaRoot({ schemaVersion: '2.8.0', modelRoot: os.tmpdir(), toolDir: os.tmpdir(), cwd: os.tmpdir(), env: {} });
    assert.equal(located.root, null);
    const { documents } = collectObservations(modelRoot);
    const { spec } = loadSpec();
    const records = measureStructure({ documents, schemaIndex: null, structureSpec: spec.structure });
    const decision = records.find((record) => record.entityId === 'BD001');
    assert.equal(decision?.fieldsAvailable, null);
    assert.deepEqual(decision?.proseOnlyReferences.map((reference) => [reference.id, reference.schemaHasField]), [['shop.VR001', null], ['DC001', null]]);
  });

  test('the schema index maps each container to its $def', () => {
    const index = loadSchemaIndex(path.join(schemaBase, 'v2.8'));
    assert.equal(index.containers.get('validation')?.type, 'rule');
    assert.equal(index.containers.get('business_decisions')?.type, 'business_decision');
  });

  test('a container two schema files define with different types has no known available set', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-quality-ambiguous-'));
    try {
      const container = (/** @type {string} */ type) => `properties:\n  parties:\n    type: array\n    items: { $ref: "#/$defs/${type}" }\n$defs:\n  ${type}:\n    type: object\n    properties:\n      id: { type: string }\n`;
      writeTree(root, { 'a.schema.yaml': container('party'), 'b.schema.yaml': container('organization_party') });
      assert.equal(loadSchemaIndex(root).containers.get('parties'), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a token resolves exactly, then within the entity\'s slice, and otherwise not at all', () => {
    const resolve = resolverFor(new Map([['shop.CN002', 'shop.CN002'], ['DC001', 'DC001']]));
    assert.equal(resolve('DC001', 'shop'), 'DC001');
    assert.equal(resolve('CN002', 'shop'), 'shop.CN002');
    assert.equal(resolve('CN009', 'shop'), undefined);
  });

  test('an unscoped token prefers the entity\'s own slice over the same id declared unscoped in another slice', () => {
    // `orders/quality.yaml` declares `KPI001` without a scope; `admin/quality.yaml` declares `admin.KPI001`.
    const resolve = resolverFor(new Map([['KPI001', 'KPI001'], ['orders.KPI001', 'KPI001'], ['admin.KPI001', 'admin.KPI001']]));
    assert.equal(resolve('KPI001', 'admin'), 'admin.KPI001');
    assert.equal(resolve('KPI001', 'orders'), 'KPI001');
  });
});
