import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';

const directory = resolve(__dirname, '..');
const repository = resolve(directory, '../../..');
const scratch = mkdtempSync(join(tmpdir(), 'navigation-packaging-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

it('loads the bundled extension and pure diagnostics without checkout dependencies', () => {
  execFileSync(process.execPath, [join(directory, 'build.mjs')]);
  const detached = join(scratch, 'detached');
  mkdirSync(join(detached, 'node_modules/vscode'), { recursive: true });
  writeFileSync(join(detached, 'node_modules/vscode/index.js'), 'module.exports = {};');
  cpSync(join(directory, 'out'), join(detached, 'out'), { recursive: true });
  cpSync(join(directory, 'schema'), join(detached, 'schema'), { recursive: true });
  const run = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    assert.equal(typeof require('./out/extension.js').activate, 'function');
    const { DiagnosticModel, schemaInputs } = require('./out/diagnostics.js');
    const model = new DiagnosticModel();
    model.update('delivery.roadmap.yaml', 'work_items: [{id: WI001, milestone: MS999}, {id: WI001}]');
    assert.deepEqual(model.evaluate(schemaInputs('./schema')).map(item => item.code),
      ['duplicate-id', 'duplicate-id', 'dangling-reference']);
  `], { cwd: detached, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  const metadata: { inputs: Record<string, unknown>; outputs: Record<string, { imports: { path: string; external?: boolean }[] }> } =
    JSON.parse(readFileSync(join(directory, 'out/bundle-meta.json'), 'utf8'));
  const imports = Object.values(metadata.outputs).flatMap((output) => output.imports);
  expect(imports.filter((entry) => entry.external && entry.path !== 'vscode' && !isBuiltin(entry.path))).toEqual([]);
  expect(Object.keys(metadata.inputs).some(file => /validator\/core\/references.mjs$/.test(file))).toBe(true);
  expect(Object.keys(metadata.inputs).filter(file => /model-builder|viewer\/v2\/core|semantic-checker/.test(file))).toEqual([]);
  expect(existsSync(join(directory, 'out/extension.js.map'))).toBe(true);
  const notices = readFileSync(join(directory, 'THIRD-PARTY-LICENSES.txt'), 'utf8');
  for (const dependency of ['ajv', 'ajv-formats', 'yaml', 'fast-deep-equal', 'json-schema-traverse', 'fast-uri']) {
    expect(notices).toContain(dependency);
  }
});

it('builds the same validator in the standalone publication layout', () => {
  const root = join(scratch, 'publication');
  const extension = join(root, 'tools/vscode-blueprint');
  mkdirSync(extension, { recursive: true });
  cpSync(join(directory, 'src'), join(extension, 'src'), { recursive: true });
  cpSync(join(directory, 'build.mjs'), join(extension, 'build.mjs'));
  cpSync(join(directory, 'package.json'), join(extension, 'package.json'));
  cpSync(join(directory, 'tsconfig.json'), join(extension, 'tsconfig.json'));
  cpSync(join(repository, 'schemas/blueprint/.shared/validator/core'), join(root, 'tools/validator/src/core'), { recursive: true });
  // Only toolchain resolution is supplied; runtime closure is checked by the detached test above.
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  const run = spawnSync('npm', ['run', 'compile'], {
    cwd: extension, encoding: 'utf8', env: process.env,
  });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  expect(existsSync(join(extension, 'out/extension.js'))).toBe(true);
});

it('fails clearly when the authoritative validator source is absent', () => {
  const extension = join(scratch, 'missing/tools/vscode-blueprint');
  mkdirSync(extension, { recursive: true });
  cpSync(join(directory, 'build.mjs'), join(extension, 'build.mjs'));
  const run = spawnSync(process.execPath, [join(extension, 'build.mjs')], { encoding: 'utf8' });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('Authoritative Apache validator source unavailable');
});

it('refuses a v2.7-only checkout instead of shipping it as v2.8', () => {
  const root = join(scratch, 'old');
  const extension = join(root, 'tools/vscode-blueprint');
  mkdirSync(extension, { recursive: true });
  mkdirSync(join(root, 'schema/v2.7'), { recursive: true });
  writeFileSync(join(root, 'schema/v2.7/metamodel.schema.yaml'), '{}');
  cpSync(join(directory, 'sync-schema.mjs'), join(extension, 'sync-schema.mjs'));
  const run = spawnSync(process.execPath, [join(extension, 'sync-schema.mjs')], { encoding: 'utf8' });
  expect(run.status).toBe(2);
  expect(run.stderr).toContain('v2.8');
});
