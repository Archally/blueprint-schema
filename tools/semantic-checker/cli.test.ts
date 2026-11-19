import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const compiledCli = path.join(packageRoot, 'tools/semantic-checker/dist/cli.js');
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueprint check '));
  temporaryDirectories.push(directory);
  return directory;
}

function copyModel(name: string, version = 'v2.8'): string {
  const relative = path.join('examples', name, '.blueprint', version);
  const directory = path.join(temporaryDirectory(), relative);
  cpSync(path.join(packageRoot, relative), directory, { recursive: true });
  return directory;
}

function check(argumentsList: string[], executable = compiledCli) {
  const result = spawnSync(process.execPath, [executable, ...argumentsList], {
    cwd: temporaryDirectory(),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', BLUEPRINT_SCHEMAS: '' },
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { status: result.status, output: result.stdout + result.stderr };
}

function isolatedCli(validatorSource?: string): string {
  const directory = temporaryDirectory();
  const checkerDirectory = path.join(directory, 'tools/semantic-checker');
  mkdirSync(checkerDirectory, { recursive: true });
  cpSync(path.join(packageRoot, 'tools/semantic-checker/dist'), path.join(checkerDirectory, 'dist'), { recursive: true });
  cpSync(path.join(packageRoot, 'package.json'), path.join(directory, 'package.json'));
  symlinkSync(path.join(packageRoot, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  symlinkSync(path.join(packageRoot, 'tools/model-builder'), path.join(directory, 'tools/model-builder'), 'dir');
  symlinkSync(path.join(packageRoot, 'tools/semantic-checker/rules'), path.join(checkerDirectory, 'rules'), 'dir');
  if (validatorSource !== undefined) {
    const validatorDirectory = path.join(directory, 'tools/validator/src');
    mkdirSync(validatorDirectory, { recursive: true });
    writeFileSync(path.join(validatorDirectory, 'cli.mjs'), validatorSource);
  }
  return path.join(checkerDirectory, 'dist/cli.js');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('semantic checker CLI input validation', () => {
  it.each([
    ['eshop', 'v2.8'],
    ['ecommerce', 'v2.8'],
    ['ecommerce', 'v2.6'],
  ])('accepts healthy %s %s with semantic warnings from another cwd and a path containing spaces', (name, version) => {
    const directory = copyModel(name, version);

    const result = check([directory]);

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/PASSED: [1-9]\d* warning\(s\), \d+ info\(s\)\./);
  });

  it('rejects a missing referenced domain file with reference diagnostics', () => {
    const directory = copyModel('eshop');
    rmSync(path.join(directory, 'ordering/domain.yaml'));

    const result = check([directory]);

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/reference/i);
    expect(result.output).toContain('ordering.');
    expect(result.output).not.toContain('PASSED');
  });

  it('rejects unparsable YAML and names the defective file', () => {
    const directory = copyModel('ecommerce');
    const filename = path.join(directory, 'orders/concepts.yaml');
    writeFileSync(filename, readFileSync(filename, 'utf8') + '\ninvalid: [\n');

    const result = check([directory]);

    expect(result.status).toBe(1);
    expect(result.output).toContain('orders/concepts.yaml');
    expect(result.output).toMatch(/pars|YAML/i);
    expect(result.output).not.toContain('PASSED');
  });

  it.each(['--help', '--list'])('serves %s without a model or validator', (argument) => {
    const executable = isolatedCli();

    const result = check([argument], executable);

    expect(result.status).toBe(0);
    expect(result.output).toContain(argument === '--help' ? 'Usage:' : 'Available rules:');
    expect(result.output).not.toContain('Validation');
  });

  it('fails when the packaged validator is unavailable', () => {
    const directory = copyModel('eshop');
    const executable = isolatedCli();

    const result = check([directory], executable);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('validator');
    expect(result.output).not.toContain('PASSED');
  });

  it('fails with a diagnostic when the validator terminates abnormally', () => {
    const directory = copyModel('eshop');
    const executable = isolatedCli("process.kill(process.pid, 'SIGTERM');\n");

    const result = check([directory], executable);

    expect(result.status).toBe(2);
    expect(result.output).toContain('SIGTERM');
    expect(result.output).not.toContain('PASSED');
  });
});
