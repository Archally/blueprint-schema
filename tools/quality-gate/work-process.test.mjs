import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { collectObservations } from './collect.mjs';
import { hasStatedProvenance, measureWorkProcessProvenance } from './work-process.mjs';
import { locateSchemaRoot, loadSchemaIndex, measureStructure } from './structure.mjs';
import { loadSpec } from './config.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(directory, '../validator/core/fixtures/work-process/illustrative');
const cli = path.join(directory, 'cli.mjs');

test('counts the actual illustrative fixture as one of five activities, without inheriting process provenance', () => {
  const { documents } = collectObservations(fixture);
  assert.deepEqual(measureWorkProcessProvenance(documents), { covered: 1, total: 5 });
});

test('counts meaningful stages, certainty and evidence, rejecting empty and unrecognized values', () => {
  for (const value of [undefined, null, {}, [], { evidence: [] }, { evidence: [{}] }, { discovery_stage: 'unknown' }, { certainty: '' }, { other: 'value' }]) {
    assert.equal(hasStatedProvenance(value), false);
  }
  for (const value of [{ discovery_stage: 'hypothesis' }, { certainty: 'speculative' }, { evidence: [{ kind: 'interview', summary: 'Observed' }] }]) {
    assert.equal(hasStatedProvenance(value), true);
  }
});

test('respects slice, changed-file and entity selections and an explicit system override', () => {
  const documents = [
    { file: '/root/blueprint.yaml', doc: { layout: { slices: [{ name: 'work', describes: 'organization' }] } } },
    { file: '/root/work/story.yaml', slice: 'work', doc: { processes: [
      { id: 'PRC001', activities: [{ provenance: { certainty: 'probable' } }, {}] },
      { id: 'PRC002', describes: 'system', activities: [{}] },
    ] } },
    { file: '/root/system/story.yaml', slice: 'system', doc: { processes: [{ activities: [{}] }] } },
  ];
  assert.deepEqual(measureWorkProcessProvenance(documents), { covered: 1, total: 2 });
  assert.deepEqual(measureWorkProcessProvenance(documents, { slice: 'system' }), { covered: 0, total: 0 });
  assert.deepEqual(measureWorkProcessProvenance(documents, { changedFiles: new Set(['/root/system/story.yaml']) }), { covered: 0, total: 0 });
  assert.deepEqual(measureWorkProcessProvenance(documents, { selection: { selected: new Set([{ file: '/root/work/story.yaml', entityId: 'PRC001' }]) } }), { covered: 1, total: 2 });
});

test('prints advisory coverage in text and JSON without changing strict exit status or scoring', () => {
  const report = execFileSync(process.execPath, [cli, fixture], { encoding: 'utf8' });
  assert.match(report, /Work-process activity provenance: 1\/5 stated \(advisory\)/);
  const normal = spawnSync(process.execPath, [cli, fixture, '--json'], { encoding: 'utf8' });
  const strict = spawnSync(process.execPath, [cli, fixture, '--json', '--strict'], { encoding: 'utf8' });
  const payload = JSON.parse(normal.stdout).runs[0];
  assert.deepEqual(payload.workProcessProvenance, { covered: 1, total: 5 });
  assert.equal(strict.status, payload.ok ? 0 : 1);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'work-provenance-'));
  try {
    fs.cpSync(fixture, temporary, { recursive: true });
    const storyFile = path.join(temporary, 'delivery/story.yaml');
    const story = YAML.parse(fs.readFileSync(storyFile, 'utf8'));
    for (const process of story.processes) {
      for (const activity of process.activities) {
        delete activity.provenance;
      }
    }
    fs.writeFileSync(storyFile, YAML.stringify(story));
    const unstated = spawnSync(process.execPath, [cli, temporary, '--json', '--strict'], { encoding: 'utf8' });
    const unstatedPayload = JSON.parse(unstated.stdout).runs[0];
    assert.deepEqual(unstatedPayload.workProcessProvenance, { covered: 0, total: 5 });
    assert.deepEqual(unstatedPayload.metrics, payload.metrics);
    assert.deepEqual(unstatedPayload.breaches, payload.breaches);
    assert.equal(unstatedPayload.ok, payload.ok);
    assert.equal(unstated.status, strict.status);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('structure already reads process describes and provenance from the actual schema', () => {
  const { documents } = collectObservations(fixture);
  const schema = locateSchemaRoot({ schemaVersion: '2.8.88', modelRoot: fixture, toolDir: directory });
  const records = measureStructure({ documents, schemaIndex: loadSchemaIndex(schema.root), structureSpec: loadSpec().spec.structure });
  const process = records.find((record) => record.entityId === 'delivery.PRC001');
  assert.ok(process);
  assert.ok(process.fieldsUsed.includes('describes'));
  assert.ok(process.fieldsUsed.includes('provenance'));
  const available = loadSchemaIndex(schema.root).containers.get('processes');
  assert.ok(available.properties.includes('describes'));
  assert.ok(available.properties.includes('provenance'));
});
