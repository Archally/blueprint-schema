import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from './config.mjs';
import * as structure from './structure.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const limits = {
  description: { max_chars: 400 },
  summary: { max_chars: 240, max_sentences: 1 },
};

test('merges text limits per field and identifies their source', () => {
  const result = config.resolveTextLength({ text_length: limits }, {
    text_length: { description: { max_chars: 500 }, summary: { off: true }, note: { max_chars: 80 } },
  });

  assert.equal(result.description.max_chars, 500);
  assert.equal(result.description.source, 'project');
  assert.equal(result.summary.off, true);
  assert.equal(result.note.max_chars, 80);
  assert.equal(config.resolveTextLength({ text_length: limits }, {}).summary.source, 'spec');
});

test('rejects malformed text limit blocks and invalid individual limits', () => {
  for (const block of [null, [], 'long', { description: null }, { description: 400 },
    { description: { max_chars: 0 } }, { description: { max_chars: 1.5 } },
    { description: { max_sentences: -1 } }, { description: { off: 'yes' } },
    { description: { max_chars: 400, typo: 1 } }, { note: {} }]) {
    assert.throws(() => config.resolveTextLength({ text_length: limits }, { text_length: block }), /text_length/);
  }
});

test('retains a sentence limit when a project overrides only the character limit', () => {
  const result = config.resolveTextLength({ text_length: limits }, { text_length: { summary: { max_chars: 120 } } });

  assert.equal(result.summary.max_chars, 120);
  assert.equal(result.summary.max_sentences, 1);
  assert.deepEqual(config.resolveTextLength({}, {}), {});
});


for (const [name, summary] of [
  ['decimal', 'Uses version 2.8 for orders.'],
  ['inline code', 'Calls `order.load().save()` once.'],
  ['URL', 'Reads https://example.org/v2.8/guide for orders.'],
  ['e.g.', 'Supports e.g. card payments.'],
  ['i.e.', 'Records i.e. settled payments.'],
  ['etc.', 'Supports cards etc. for payment.'],
  ['vs.', 'Compares gross vs. net amounts.'],
]) {
  test(`ignores punctuation within ${name} when counting summary sentences`, () => {
    assert.equal(structure.countTextSentences(summary), 1);
    assert.equal(structure.countTextSentences(`${summary} Records a receipt.`), 2);
  });
}

test('measures trimmed text at any depth and rolls nested parts into their observed owner once', () => {
  const file = '/fixture/domain.yaml';
  const operation = { key: `${file}\u0000shop.CMD001`, entityId: 'shop.CMD001', name: 'Place Order', file };
  const documents = [{ file, doc: { operations: { placeOrder: {
    id: 'shop.CMD001', description: '  **Orders**  ',
    details: [{ summary: 'First sentence. Second sentence.' }],
    part: { id: 'shop.CAT001', description: 'Nested property text.' },
  } } } }];
  const result = structure.measureTextLength({ documents, entities: [operation], limits: {
    description: { max_chars: 10, source: 'spec' }, summary: { max_chars: 240, max_sentences: 1, source: 'spec' },
  } });

  assert.equal(result.fields.description.measured, 2);
  assert.equal(result.fields.description.overLimit, 1);
  assert.equal(result.fields.description.longest, 21);
  assert.equal(result.fields.summary.overLimit, 1);
  assert.equal(operation.textLength.length, 2);
  assert.equal(operation.textLength[0].path, 'operations/placeOrder/details/0/summary');
  assert.equal(operation.textLength[0].sentences, 2);
  assert.equal(operation.textLength[1].path, 'operations/placeOrder/part/description');
});

test('keeps observed child entities separate and skips disabled fields and reference strings', () => {
  const file = '/fixture/concepts.yaml';
  const entities = ['CN001', 'CN002'].map(entityId => ({ key: `${file}\u0000${entityId}`, entityId, file }));
  const result = structure.measureTextLength({ documents: [{ file, doc: { concepts: [{
    id: 'CN001', description: 'Long description.', ref: 'CN002', summary: 'Two. Sentences.',
    child: { id: 'CN002', description: 'Child description.' },
  }] } }], entities, limits: { description: { max_chars: 17 }, summary: { off: true } } });

  assert.equal(result.fields.description.measured, 2);
  assert.equal(result.fields.description.overLimit, 1);
  assert.deepEqual(entities[0].textLength, []);
  assert.equal(entities[1].textLength[0].length, 18);
  assert.equal(result.fields.summary.measured, 0);
});


const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
function withFixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'text-length-'));
  try {
    fs.mkdirSync(path.join(root, 'shop'));
    fs.writeFileSync(path.join(root, 'shop', 'domain.yaml'), YAML.stringify({ operations: {
      placeOrder: { id: 'shop.CMD001', name: 'Place Order', kind: 'command',
        description: 'Orders record the products and quantities selected for purchase. '.repeat(8),
        summary: 'Records an order. Reserves stock.' },
      cancelOrder: { id: 'shop.CMD002', name: 'Cancel Order', kind: 'command', description: 'Cancels an order.' },
    } }));
    const spec = path.join(root, 'spec.config');
    fs.writeFileSync(spec, YAML.stringify({ metrics: { 'domain.operation.description': {
      layer: 'domain', threshold: 1, patch_threshold: 1,
    } }, text_length: limits }));
    const run = (...flags) => spawnSync(process.execPath, [cli, root, '--spec', spec, ...flags], { encoding: 'utf8' });
    action({ root, run });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('strict mode reports long text without changing coverage, baseline, verdict or exit code', () => {
  withFixture(({ root, run }) => {
    const long = run('--strict', '--json');
    assert.equal(long.status, 0, long.stderr);
    const before = JSON.parse(long.stdout).runs[0];
    assert.equal(before.textLength.fields.description.overLimit, 1);
    assert.equal(before.textLength.fields.summary.overLimit, 1);
    fs.writeFileSync(path.join(root, '.blueprint-quality.yaml'), YAML.stringify({ text_length: {
      description: { off: true }, summary: { off: true },
    } }));
    const disabled = run('--strict', '--json');
    const after = JSON.parse(disabled.stdout).runs[0];

    assert.equal(disabled.status, long.status);
    assert.deepEqual(after.metrics, before.metrics);
    assert.deepEqual(after.breaches, before.breaches);
    assert.equal(after.ok, before.ok);
    assert.equal(after.textLength.fields.description.measured, 0);
  });
});

test('project overrides change limits, disable fields and report their source in JSON', () => {
  withFixture(({ root, run }) => {
    fs.writeFileSync(path.join(root, '.blueprint-quality.yaml'), YAML.stringify({ text_length: {
      description: { max_chars: 20 }, summary: { off: true },
    } }));
    const response = run('--json');
    const result = JSON.parse(response.stdout).runs[0];

    assert.equal(response.status, 0, response.stderr);
    assert.equal(result.textLength.limits.description.max_chars, 20);
    assert.equal(result.textLength.limits.description.source, 'project');
    assert.equal(result.textLength.fields.summary.measured, 0);
    assert.equal(result.entities[0].textLength[0].field, 'description');
    assert.equal(result.entities[0].textLength[0].limit, 20);
  });
});

test('whole model, slice, file and entity reports expose text warnings within their selection', () => {
  withFixture(({ run }) => {
    for (const flags of [[], ['--slice', 'shop'], ['--file', 'shop/domain.yaml'], ['--entity', 'shop.CMD001']]) {
      const response = run(...flags);
      assert.equal(response.status, 0, response.stderr);
      assert.match(response.stdout, /Text length \(advisory\)|description \d+ chars, limit 400 \(advisory\)/);
      assert.match(response.stdout, /summary/);
    }
    const selected = JSON.parse(run('--entity', 'shop.CMD002', '--json').stdout).runs[0];
    assert.equal(selected.textLength.fields.description.measured, 1);
    assert.equal(selected.textLength.fields.description.overLimit, 0);
    assert.deepEqual(selected.entities[0].textLength, []);
  });
});

test('worst limits the longest field list while JSON retains every offender', () => {
  withFixture(({ run }) => {
    const report = run('--worst', '1');
    assert.match(report.stdout, /Longest text fields/);
    const list = report.stdout.split('Longest text fields')[1].split('\n\n')[0];
    assert.equal((list.match(/shop.CMD001/g) ?? []).length, 1);
    const result = JSON.parse(run('--worst', '1', '--json').stdout).runs[0];
    assert.equal(result.entities[0].textLength.length, 2);
  });
});

test('ships the four field defaults and per-field-kind limits with one-sentence summaries and exempt rows', () => {
  const spec = config.loadSpec().spec;
  const defaults = spec.text_length;
  const resolved = config.resolveTextLength(spec, {});

  for (const fallback of ['description', 'summary', 'rationale', 'context']) {
    assert.ok(Object.hasOwn(defaults, fallback), `missing fallback ${fallback}`);
    assert.equal(typeof defaults[fallback].calibration, 'string');
    assert.ok(defaults[fallback].calibration.length > 20);
  }
  assert.equal(defaults.description.max_chars, 400);
  assert.equal(resolved.description.hard_chars, 600);
  assert.equal(defaults.summary.max_chars, 240);
  assert.equal(defaults.summary.max_sentences, 1);
  assert.equal(resolved.summary.hard_chars, 360);
  assert.equal(defaults.rationale.max_chars, 600);
  assert.equal(resolved.rationale.hard_chars, 900);
  assert.equal(defaults.context.max_chars, 600);
  assert.equal(resolved.context.hard_chars, 900);

  assert.equal(Object.keys(defaults).length, 493);
  assert.equal(resolved['operation / description'].max_chars, 400);
  assert.equal(resolved['operation / description'].hard_chars, 600);
  assert.equal(resolved['model_property / description'].max_chars, 140);
  assert.equal(resolved['model_property / description'].hard_chars, 210);
  assert.equal(resolved['register_change / description'].max_chars, 280);
  assert.equal(resolved['register_change / description'].hard_chars, 420);
  assert.equal(resolved['finding / statement'].max_chars, 400);
  assert.equal(resolved['finding / statement'].hard_chars, 600);
  assert.equal(resolved['service / description'].max_chars, 800);
  assert.equal(resolved['service / description'].hard_chars, 1200);
  assert.equal(resolved['evidence / [].summary'].max_chars, 280);
  assert.equal(resolved['evidence / [].summary'].max_sentences, 1);
  assert.equal(resolved['evidence / [].summary'].hard_chars, 420);
  assert.equal(resolved['concept_attribute / example'].off, true);
  assert.equal(resolved['design/domain: (root) / description'].max_chars, 800);
  assert.equal(resolved['governance/roadmap: (root) / description'].max_chars, 280);
});

test('computes 1.5x rounded hard limits, accepts hard_chars overrides and rejects invalid hard limits', () => {
  assert.equal(config.defaultHardChars(140), 210);
  assert.equal(config.defaultHardChars(280), 420);
  assert.equal(config.defaultHardChars(400), 600);
  assert.equal(config.defaultHardChars(600), 900);
  assert.equal(config.defaultHardChars(800), 1200);
  assert.equal(config.defaultHardChars(2), 3);

  const overridden = config.resolveTextLength(
    { text_length: { 'operation / description': { max_chars: 400 } } },
    { text_length: { 'operation / description': { hard_chars: 550 } } },
  );
  assert.equal(overridden['operation / description'].max_chars, 400);
  assert.equal(overridden['operation / description'].hard_chars, 550);

  const recomputed = config.resolveTextLength(
    { text_length: { description: { max_chars: 400 } } },
    { text_length: { description: { max_chars: 280 } } },
  );
  assert.equal(recomputed.description.hard_chars, 420);

  for (const bad of [
    { description: { max_chars: 400, hard_chars: 300 } },
    { description: { max_chars: 400, hard_chars: 0 } },
    { description: { max_chars: 400, hard_chars: 450.5 } },
    { description: { max_chars: 400, hard_chars: '600' } },
  ]) {
    assert.throws(() => config.resolveTextLength({}, { text_length: bad }), /text_length/);
  }
});

test('resolves rules by schema-qualified field kind, definition/property, then bare field fallback, honoring off', () => {
  const resolvedLimits = config.resolveTextLength({
    text_length: {
      description: { max_chars: 400 },
      example: { max_chars: 20 },
      'operation / description': { max_chars: 280 },
      'design/domain: (root) / description': { max_chars: 800 },
      '(root) / description': { max_chars: 600 },
      'concept_attribute / example': { off: true },
    },
  }, {});

  const qualified = config.resolveTextLengthRule(resolvedLimits, {
    schemaName: 'design/domain',
    definition: '(root)',
    propertyPath: 'description',
    field: 'description',
  });
  assert.equal(qualified?.key, 'design/domain: (root) / description');
  assert.equal(qualified?.rule.max_chars, 800);

  const defProp = config.resolveTextLengthRule(resolvedLimits, {
    schemaName: 'design/domain',
    definition: 'operation',
    propertyPath: 'description',
    field: 'description',
  });
  assert.equal(defProp?.key, 'operation / description');
  assert.equal(defProp?.rule.max_chars, 280);

  const fallback = config.resolveTextLengthRule(resolvedLimits, {
    schemaName: 'design/domain',
    definition: 'unlisted_def',
    propertyPath: 'description',
    field: 'description',
  });
  assert.equal(fallback?.key, 'description');
  assert.equal(fallback?.rule.max_chars, 400);

  const exempt = config.resolveTextLengthRule(resolvedLimits, {
    schemaName: 'design/concepts',
    definition: 'concept_attribute',
    propertyPath: 'example',
    field: 'example',
  });
  assert.equal(exempt?.key, 'concept_attribute / example');
  assert.equal(exempt?.rule.off, true);

  assert.equal(config.resolveTextLengthRule(resolvedLimits, { field: 'unknown_field' }), null);
});

test('measures per-field-kind limits from schemas across refs, arrays and exempt rows with soft and hard totals', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'text-length-schema-'));
  try {
    const schemaDir = path.join(tmpRoot, 'schema');
    fs.mkdirSync(path.join(schemaDir, 'design'), { recursive: true });
    fs.writeFileSync(path.join(schemaDir, 'metamodel.schema.yaml'), YAML.stringify({
      $defs: {
        code_ref_entry: {
          type: 'object',
          properties: {
            description: { type: 'string' },
          },
        },
      },
    }));
    fs.writeFileSync(path.join(schemaDir, 'design', 'domain.schema.yaml'), YAML.stringify({
      type: 'object',
      properties: {
        operations: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/operation' },
        },
      },
      $defs: {
        operation: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            example: { type: 'string' },
            invariants: { type: 'array', items: { type: 'string' } },
            code_refs: {
              type: 'array',
              items: { $ref: '../metamodel.schema.yaml#/$defs/code_ref_entry' },
            },
          },
        },
      },
    }));

    const file = path.join(tmpRoot, 'shop', 'domain.yaml');
    const entity = { key: `${file}\u0000CMD001`, entityId: 'CMD001', name: 'Place Order', file };
    const documents = [{
      file,
      doc: {
        operations: {
          placeOrder: {
            id: 'CMD001',
            description: 'a'.repeat(25),
            example: 'e'.repeat(80),
            invariants: ['i'.repeat(25)],
            code_refs: [{ description: 'c'.repeat(25) }],
          },
        },
      },
    }];
    const resolvedLimits = config.resolveTextLength({
      text_length: {
        description: { max_chars: 100 },
        example: { max_chars: 10 },
        'operation / description': { max_chars: 20 },
        'operation / example': { off: true },
        'operation / invariants[]': { max_chars: 10 },
        'code_ref_entry / description': { max_chars: 10 },
      },
    }, {});

    const measured = structure.measureTextLength({
      documents,
      entities: [entity],
      limits: resolvedLimits,
      schemaRoot: tmpRoot,
    });

    assert.equal(measured.fields['operation / description'].measured, 1);
    assert.equal(measured.fields['operation / description'].overLimit, 1);
    assert.equal(measured.fields['operation / description'].overHardLimit, 0);
    assert.equal(measured.fields['code_ref_entry / description'].overLimit, 1);
    assert.equal(measured.fields['code_ref_entry / description'].overHardLimit, 1);
    assert.equal(measured.fields['operation / invariants[]'].overLimit, 1);
    assert.equal(measured.fields['operation / invariants[]'].overHardLimit, 1);
    assert.equal(measured.fields['operation / example'].measured, 0);
    assert.equal(measured.fields.example.measured, 0);
    assert.equal(measured.fields.description.measured, 0);
    assert.deepEqual(measured.totals, {
      measured: 3,
      overLimit: 3,
      overHardLimit: 2,
      overChars: 3,
      overSentences: 0,
    });

    const hardRecords = entity.textLength.filter((item) => item.overHardLimit);
    assert.equal(hardRecords.length, 2);
    assert.equal(entity.textLength.find((item) => item.ruleKey === 'operation / description').hardLimit, 30);
    assert.equal(entity.textLength.find((item) => item.ruleKey === 'operation / invariants[]').field, 'invariants[]');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('reports over-hard-limit list before soft counts in text and exposes totals in JSON without failing strict', () => {
  withFixture(({ root, run }) => {
    fs.writeFileSync(path.join(root, '.blueprint-quality.yaml'), YAML.stringify({
      text_length: {
        description: { max_chars: 200, hard_chars: 300 },
      },
    }));

    const jsonRes = run('--strict', '--json');
    assert.equal(jsonRes.status, 0, jsonRes.stderr);
    const runData = JSON.parse(jsonRes.stdout).runs[0];
    assert.equal(runData.ok, true);
    assert.equal(runData.textLength.totals.overLimit, 2);
    assert.equal(runData.textLength.totals.overHardLimit, 1);
    assert.equal(runData.textLength.fields.description.overLimit, 1);
    assert.equal(runData.textLength.fields.description.overHardLimit, 1);
    assert.equal(runData.textLength.fields.summary.overLimit, 1);
    assert.equal(runData.textLength.fields.summary.overHardLimit, 0);
    const descOffender = runData.entities[0].textLength.find((item) => item.field === 'description');
    assert.equal(descOffender.limit, 200);
    assert.equal(descOffender.hardLimit, 300);
    assert.equal(descOffender.overLimit, true);
    assert.equal(descOffender.overHardLimit, true);

    const textRes = run('--strict');
    assert.equal(textRes.status, 0, textRes.stderr);
    const hardIdx = textRes.stdout.indexOf('Over the hard limit (1):');
    const softIdx = textRes.stdout.indexOf('Soft limit counts (');
    assert.ok(hardIdx !== -1, textRes.stdout);
    assert.ok(softIdx !== -1, textRes.stdout);
    assert.ok(hardIdx < softIdx, 'Over the hard limit list must appear before Soft limit counts');
    assert.match(textRes.stdout, /shop\.CMD001 Place Order.*description \d+ chars, hard limit 300 \(soft 200\)/);
  });
});

test('counts Unicode characters after trimming and warns only above the exact boundary', () => {
  const file = '/fixture/domain.yaml';
  const entities = [{ file, entityId: 'CMD001' }];
  const result = structure.measureTextLength({ documents: [{ file, doc: { id: 'CMD001',
    description: '  😀😀  ', details: { description: '**x**' },
  } }], entities, limits: { description: { max_chars: 2 } } });

  assert.equal(result.fields.description.measured, 2);
  assert.equal(result.fields.description.overLimit, 1);
  assert.equal(entities[0].textLength[0].length, 5);
});

for (const source of ['project', 'spec']) {
  test(`malformed ${source} text limits exit 2 even without strict mode`, () => {
    withFixture(({ root, run }) => {
      const target = source === 'project' ? path.join(root, '.blueprint-quality.yaml') : path.join(root, 'spec.config');
      const doc = source === 'project' ? {} : YAML.parse(fs.readFileSync(target, 'utf8'));
      doc.text_length = { description: { max_chars: '400' } };
      fs.writeFileSync(target, YAML.stringify(doc));
      const response = run('--json');

      assert.equal(response.status, 2);
      assert.match(response.stderr, /text_length.description.max_chars/);
    });
  });
}

test('450-character prose across all 12 v2.8 schema files produces over-hard advisories and never an error', () => {
  const longProse = 'Long prose text '.repeat(28) + 'ok';
  assert.equal(longProse.length, 450);
  const v28Root = fileURLToPath(new URL('../../v2.8', import.meta.url));
  const spec = config.loadSpec().spec;
  const resolvedLimits = config.resolveTextLength(spec, {});

  const cases = [
    { rel: 'shop/arch.yaml', id: 'PRB001', ruleKey: 'probe / summary', doc: { name: 'demo', contexts: [], probes: [{ id: 'PRB001', name: 'Probe', question: 'Q?', summary: longProse }] } },
    { rel: 'shop/concepts.yaml', id: 'CN001', ruleKey: 'concept / summary', doc: { version: '2.8.0', concepts: [{ id: 'CN001', name: 'Order', summary: longProse }] } },
    { rel: 'shop/domain.yaml', ids: ['QN001', 'CMD001'], ruleKey: 'question / summary', doc: { name: 'shop', version: '2.8.0', operations: { placeOrder: { id: 'CMD001', kind: 'command', examples: [{ name: 'ex', description: longProse }] } }, questions: [{ id: 'QN001', statement: 'Q?', summary: longProse }] } },
    { rel: 'shop/dynamics.yaml', ids: ['PAR001'], ruleKey: 'parallelism_opportunity / summary', doc: { version: '2.8.0', parallelism: [{ id: 'PAR001', name: 'Par', operations: ['CMD001'], relationship: 'independent', summary: longProse }] } },
    { rel: 'shop/interactions.yaml', ids: ['SCR001'], ruleKey: 'screen / summary', doc: { version: '2.8.0', screens: [{ id: 'SCR001', name: 'Checkout', summary: longProse }] } },
    { rel: 'shop/quality.yaml', ids: ['MT001'], ruleKey: 'metric / summary', doc: { version: '2.8.0', metrics: [{ id: 'MT001', name: 'Latency', type: 'latency', unit: 'ms', summary: longProse }] } },
    { rel: 'shop/rules.yaml', ids: ['SR001'], ruleKey: 'rule / summary', doc: { version: '2.8.0', structural: [{ id: 'SR001', name: 'Rule', summary: longProse }] } },
    { rel: 'shop/story.yaml', ids: ['US001'], ruleKey: 'user_story / summary', doc: { name: 'shop', version: '2.8.0', processes: [], user_stories: [{ id: 'US001', actor: 'ACT001', goal: 'Buy', summary: longProse }] } },
    { rel: 'shop/decisions.yaml', ids: ['DC001'], ruleKey: 'decision / summary', doc: { version: '2.8.0', decisions: [{ id: 'DC001', title: 'Dec', summary: longProse, date: '2026-11-25', status: 'accepted', rationale: { problem: 'Load.', chosen: 'Async.' } }] } },
    { rel: 'shop/leverage.yaml', ids: ['LP001'], ruleKey: 'leverage_point / summary', doc: { version: '2.8.0', leverage_points: [{ id: 'LP001', title: 'Lev', one_thing: 'Do X', summary: longProse }] } },
    { rel: 'shop/motivation.yaml', ids: ['GL001', 'CNC001'], ruleKey: 'goal / summary', doc: { version: '2.8.0', goals: [{ id: 'GL001', statement: 'Fast', priority: 'high', summary: longProse }], concerns: [{ id: 'CNC001', title: longProse, statement: 'Predictable.' }] } },
    { rel: 'shop/test-cases.yaml', ids: ['TC001'], ruleKey: 'test_case / summary', doc: { version: '2.8.0', happy_path: [{ id: 'TC001', name: 'Case', summary: longProse, validates: { operations: ['CMD001'] } }] } },
  ];

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'text-length-v28-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'shop'), { recursive: true });
    const documents = [];
    const entities = [];
    for (const item of cases) {
      const file = path.join(tmpRoot, item.rel);
      fs.writeFileSync(file, YAML.stringify(item.doc));
      documents.push({ file, doc: item.doc });
      for (const id of item.ids ?? [item.id]) {
        entities.push({ key: `${file}\u0000${id}`, entityId: id, name: id, file });
      }
    }
    const measured = structure.measureTextLength({
      documents,
      entities,
      limits: resolvedLimits,
      schemaRoot: v28Root,
    });
    for (const item of cases) {
      const bucket = measured.fields[item.ruleKey];
      assert.ok(bucket, `missing measured bucket for ${item.ruleKey}`);
      assert.equal(bucket.overLimit, 1, `${item.ruleKey} should exceed soft limit`);
      assert.equal(bucket.overHardLimit, 1, `${item.ruleKey} should exceed hard limit`);
    }
    assert.equal(measured.fields['operation / examples[].description'].overHardLimit, 1);
    assert.equal(measured.fields['concern / title'].overHardLimit, 1);

    const zeroThresholdMetrics = Object.fromEntries(
      Object.entries(spec.metrics ?? {}).map(([key, def]) => [key, { ...def, threshold: 0, patch_threshold: 0 }]),
    );
    const relaxedSpec = path.join(tmpRoot, 'spec.yaml');
    fs.writeFileSync(relaxedSpec, YAML.stringify({ metrics: zeroThresholdMetrics, text_length: spec.text_length }));
    const res = spawnSync(process.execPath, [cli, tmpRoot, '--spec', relaxedSpec, '--strict', '--json'], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const runData = JSON.parse(res.stdout).runs[0];
    assert.equal(runData.ok, true);
    assert.ok(runData.textLength.totals.overHardLimit >= 12, `expected >=12 overHardLimit, got ${runData.textLength.totals.overHardLimit}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
