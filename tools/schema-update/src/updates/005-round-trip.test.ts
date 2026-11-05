/** A migrated free-string model validates under the v2.8 schema.
 * BLUEPRINT_TEST_SCHEMA_ROOT and BLUEPRINT_TEST_VALIDATOR bind external test resources.
 * Missing resources fail the test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './005-v28-typed-ids.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATOR = process.env.BLUEPRINT_TEST_VALIDATOR ?? path.resolve(PACKAGE_ROOT, '../validator/cli.mjs');
const SCHEMAS = process.env.BLUEPRINT_TEST_SCHEMA_ROOT ?? path.resolve(PACKAGE_ROOT, '../../v2.8/schema');

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'v28-round-trip-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A model with BOTH defects the migration answers: two free-string resource ids with a TOSCA
 * relation between them, and a context and service that carry no id at all.
 */
function writeFixture(): string {
  const model = path.join(root, 'v2.7');
  fs.mkdirSync(model);
  const write = (name: string, content: string): void => fs.writeFileSync(path.join(model, name), content, 'utf8');

  write(
    'blueprint.yaml',
    [
      'version: "1.0.0"',
      'schemaVersion: "2.7.0"',
      'name: "Round Trip"',
      'description: "A synthetic model carrying free-string infrastructure ids and id-less arch entities."',
      'layout:',
      '  mode: unified',
      '',
    ].join('\n'),
  );
  write(
    'arch.yaml',
    [
      'name: "Round Trip - architecture"',
      'version: "1.0.0"',
      'parties:',
      '  - id: PRT001',
      '    name: Acme',
      '    kind: organization',
      '    env: production',
      '    contexts:',
      '      - name: Orders',
      '        kind: core',
      '        summary: Placing and tracking customer orders.',
      '        services:',
      '          - name: OrderService',
      '            description: Owns the order lifecycle.',
      '',
    ].join('\n'),
  );
  write(
    'infrastructure.yaml',
    [
      'name: "Round Trip - infrastructure"',
      'version: "1.0.0"',
      'resources:',
      '  - id: orders-api',
      '    kind: api',
      '    name: Orders API',
      '    relations:',
      '      - type: depends_on',
      '        target: orders-db',
      '  - id: orders-db',
      '    kind: database',
      '    name: Orders DB',
      '',
    ].join('\n'),
  );
  return model;
}

interface Verdict {
  errors: string[];
  warnings: string[];
}

function validate(model: string): Verdict {
  let output: string;
  try {
    output = execFileSync(process.execPath, [VALIDATOR, '--model', model, '--schemas', SCHEMAS], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // The validator exits non-zero when the model has errors, which is the normal "before" case.
    const failure = error as { stdout?: string; status?: number };
    if (typeof failure.stdout !== 'string') throw error;
    output = failure.stdout;
  }
  // A run that read nothing reports zero errors, and zero errors is what every assertion here is
  // looking for. Pointing the validator at a directory the migration failed to create would
  // therefore read as a clean model. The file count is what separates the two.
  const validated = /^Files:\s+(\d+) validated/m.exec(output);
  if (!validated || Number(validated[1]) === 0) {
    throw new Error(`the validator read no files under ${model} - a verdict about nothing is not a verdict`);
  }
  const section = (heading: string): string[] => {
    const lines = output.split('\n');
    const start = lines.findIndex((line) => line.startsWith(heading));
    if (start === -1) return [];
    const found: string[] = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line.startsWith('  - ')) break;
      found.push(line.slice(4));
    }
    return found;
  };
  return { errors: section('Schema Errors'), warnings: section('Gap Warnings') };
}

const TYPED_ID_WARNING = /SHOULD match (IR|ENV|BND|DSC)###/;

describe('005 round trip - free-string in, typed out, valid under v2.8', () => {
  it('has a validator and a v2.8 schema tree to measure against', () => {
    // The premise control. Without it every assertion below could pass on a validator that was
    // never found and a tree that does not exist.
    expect(fs.existsSync(VALIDATOR), `validator not found at ${VALIDATOR}`).toBe(true);
    expect(fs.existsSync(SCHEMAS), `v2.8 schema tree not found at ${SCHEMAS}`).toBe(true);
  });

  it('the fixture really does carry both defects before the migration', () => {
    // The second premise control. A round trip that starts clean proves nothing about a migration.
    const before = validate(writeFixture());
    expect(before.warnings.filter((w) => TYPED_ID_WARNING.test(w))).toHaveLength(2);
    // A free-string `relations[].target` is ALREADY a schema error rather than a warning, because
    // the REFERENCE is pattern-typed while the id it points at is not. The two halves of one
    // family disagreed, and that disagreement is what v2.8 closes.
    expect(before.errors.some((e) => e.includes('/relations/0/target'))).toBe(true);
  });

  it('migrates to a model with 0 schema errors', () => {
    const model = writeFixture();
    expect(update.apply(model).applied).toBe(true);
    const after = validate(path.join(root, 'v2.8'));
    expect(after.errors).toEqual([]);
  });

  it('leaves no typed-id warning behind', () => {
    // 0 errors alone would be satisfied by a migration that retyped nothing and merely happened not
    // to break anything. The warning class this release promotes to ERROR must be empty.
    const model = writeFixture();
    update.apply(model);
    const after = validate(path.join(root, 'v2.8'));
    expect(after.warnings.filter((w) => TYPED_ID_WARNING.test(w))).toEqual([]);
  });

  it('leaves the model where the migration says it put it, and the source line beside it', () => {
    update.apply(writeFixture());
    expect(fs.readFileSync(path.join(root, 'v2.8', 'blueprint.yaml'), 'utf8')).toContain('schemaVersion: "2.8.0"');
    expect(fs.existsSync(path.join(root, 'v2.7'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'v2.7', 'blueprint.yaml'), 'utf8')).toContain('schemaVersion: "2.7.0"');
  });
});
