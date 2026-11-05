import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelFiles, modelYamlFiles, MODEL_DOT_DIRECTORIES_FOR_TEST } from './model-files.js';

/**
 * What the chain counts as part of the model.
 *
 * The fixture is a model root holding one of each thing a real one holds: ordinary documents in a
 * slice folder, a change program under `.migrations/`, and the tooling side-cars that sit beside
 * them. The assertions that matter are the two halves of the policy - the change program is found,
 * and nothing under a tooling directory is.
 */
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-files-'));
  fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.migrations'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.quality'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.audit'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.specs'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'blueprint.yaml'), 'name: Shop\n');
  fs.writeFileSync(path.join(dir, 'orders', 'arch.yaml'), 'contexts: []\n');
  fs.writeFileSync(path.join(dir, 'orders', 'notes.md'), '# Orders\n');
  fs.writeFileSync(path.join(dir, '.migrations', 'MIG001-split.migration.yaml'), 'migration:\n  id: MIG001\n');
  fs.writeFileSync(path.join(dir, '.quality', 'baseline.yaml'), 'score: 1\n');
  fs.writeFileSync(path.join(dir, '.audit', 'model.yaml'), 'audited: true\n');
  fs.writeFileSync(path.join(dir, '.specs', 'overview.md'), '# Spec\n');
  fs.writeFileSync(path.join(dir, '.blueprint-quality.yaml'), 'policy: x\n');
  fs.writeFileSync(path.join(dir, 'orders', '.gitkeep'), '');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function relative(files: string[]): string[] {
  return files.map((file) => path.relative(dir, file).split(path.sep).join('/'));
}

describe('what the chain treats as part of the model', () => {
  it('finds a change program, because its ids are references into the model', () => {
    expect(relative(modelYamlFiles(dir))).toContain('.migrations/MIG001-split.migration.yaml');
  });

  it('leaves every tooling side-car alone, even when it holds YAML', () => {
    const found = relative(modelYamlFiles(dir));
    expect(found).not.toContain('.quality/baseline.yaml');
    expect(found).not.toContain('.audit/model.yaml');
  });

  it('skips a dot-FILE at the model root, which is configuration rather than a document', () => {
    expect(relative(modelYamlFiles(dir))).not.toContain('.blueprint-quality.yaml');
  });

  it('finds the ordinary documents, which is the case nobody would notice breaking', () => {
    const found = relative(modelYamlFiles(dir));
    expect(found).toContain('blueprint.yaml');
    expect(found).toContain('orders/arch.yaml');
  });

  it('returns a stable order, so two runs report their changes the same way', () => {
    expect(relative(modelYamlFiles(dir))).toEqual([...relative(modelYamlFiles(dir))].sort());
  });

  it('splits prose from YAML, and keeps a tooling note out of the prose half', () => {
    const { yaml, prose } = modelFiles(dir);
    expect(relative(prose)).toEqual(['orders/notes.md']);
    expect(relative(yaml)).toContain('.migrations/MIG001-split.migration.yaml');
  });

  it('names every dot-directory it admits, so adding one is a deliberate act', () => {
    expect([...MODEL_DOT_DIRECTORIES_FOR_TEST]).toEqual(['.migrations']);
  });
});
