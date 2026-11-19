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

test('ships the four field defaults with calibrated limits and one-sentence summaries', () => {
  const defaults = config.loadSpec().spec.text_length;

  assert.deepEqual(Object.keys(defaults), ['description', 'summary', 'rationale', 'context']);
  assert.equal(defaults.description.max_chars, 400);
  assert.equal(defaults.summary.max_chars, 240);
  assert.equal(defaults.summary.max_sentences, 1);
  assert.equal(defaults.rationale.max_chars, 600);
  assert.equal(defaults.context.max_chars, 600);
  for (const field of Object.values(defaults)) {
    assert.equal(typeof field.calibration, 'string');
    assert.ok(field.calibration.length > 20);
  }
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
