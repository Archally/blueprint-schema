import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const sourceRules = fileURLToPath(new URL('.', import.meta.url));
const sourceBuilder = fileURLToPath(new URL('../model-builder/', import.meta.url));
const candidate = readFileSync(join(sourceRules, 'feature-user-stories.mjs'), 'utf8');
const originalImport = "import { compareFeatureUserStories } from '@archally/blueprint-model-builder';";

function packageRoot(name, from) {
  let directory = dirname(createRequire(from).resolve(name));
  while (!existsSync(join(directory, 'package.json')) ||
    JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name !== name) {
    const parent = dirname(directory);
    assert.notEqual(parent, directory, `Cannot locate installed package ${name}`);
    directory = parent;
  }
  return directory;
}

// Copy the installed public checker and its runtime dependencies, never workspace links.
function copyChecker(root) {
  const copied = new Map();
  function copyPackage(name, from, target) {
    const source = packageRoot(name, from);
    if (copied.has(name)) {
      assert.equal(copied.get(name), source, `Fixture needs two versions of ${name}`);
      return;
    }
    copied.set(name, source);
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: path => !path.slice(source.length).split('/').includes('node_modules'),
    });
    const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      copyPackage(dependency, join(source, 'package.json'), join(root, 'node_modules', dependency));
    }
  }
  copyPackage('@archally/semantic-checker', import.meta.url, join(root, 'tools/semantic-checker'));
}

function assertNoSymlinks(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, path);
    if (stat.isDirectory()) assertNoSymlinks(path);
  }
}

function fixture(t, { checker = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'feature-user-stories-portability-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (checker) copyChecker(root);
  const rules = join(root, 'tools/semantic-checker/rules');
  const builder = join(root, 'tools/model-builder');
  mkdirSync(rules, { recursive: true });
  mkdirSync(builder, { recursive: true });
  writeFileSync(join(builder, 'package.json'), '{"type":"module"}\n');
  cpSync(join(sourceBuilder, 'dist'), join(builder, 'dist'), { recursive: true, dereference: true });
  cpSync(join(sourceRules, 'feature-user-stories.yaml'), join(rules, 'feature-user-stories.yaml'));
  writeFileSync(join(rules, 'feature-user-stories.mjs'), candidate);
  assertNoSymlinks(root);
  assert.equal(existsSync(join(root, 'node_modules/@archally/blueprint-model-builder')), false);
  return { root, rules, builder };
}

function run(root, code, arguments_ = []) {
  const environment = { ...process.env };
  delete environment.NODE_PATH;
  delete environment.NODE_OPTIONS;
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, code === null ? arguments_ : ['--input-type=module', '-e', code], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  return result;
}

function importRule(root, rules) {
  const ruleURL = pathToFileURL(join(rules, 'feature-user-stories.mjs')).href;
  return run(root, `const rule = await import(${JSON.stringify(ruleURL)});
    for (const name of ['featureStoryExclusive', 'featureStoryMismatch']) {
      if (typeof rule[name] !== 'function') throw new Error('Missing function ' + name);
    }
    console.log('Both rule exports are functions');`);
}

test('original package import fails in the isolated public tree', t => {
  const { root, rules } = fixture(t);
  writeFileSync(join(rules, 'original.mjs'), originalImport + '\n' + candidate.slice(candidate.indexOf('const cache')));
  const result = run(root, `await import(${JSON.stringify(pathToFileURL(join(rules, 'original.mjs')).href)})`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(result.stderr, /Cannot find package '@archally\/blueprint-model-builder'/);
  t.diagnostic('RED control: original import fails with ERR_MODULE_NOT_FOUND without a workspace package');
});

test('public layout loads both exports and runs all existing diagnostic fixtures through the public built checker', t => {
  const { root, rules, builder } = fixture(t, { checker: true });
  const imported = importRule(root, rules);
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Both rule exports are functions/);
  const fixtures = readFileSync(join(sourceRules, 'feature-user-stories.test.mjs'), 'utf8');
  assert.ok(fixtures.includes("from '@archally/semantic-checker'"));
  writeFileSync(join(rules, 'fixtures.test.mjs'), fixtures.replace("from '@archally/semantic-checker'", "from '../dist/index.js'"));
  const checked = run(root, null, ['--test', '--test-reporter=tap', join(rules, 'fixtures.test.mjs')]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /# tests 7\b/);
  assert.match(checked.stdout, /# fail 0\b/);
  t.diagnostic(`Temporary layout: ${root}/tools/{semantic-checker/{rules,dist},model-builder/dist}; copied runtime dependencies in node_modules; no symlinks, NODE_PATH or NODE_OPTIONS`);
  t.diagnostic(`Resolved helper URL: ${pathToFileURL(join(builder, 'dist/extraction/relations/featureUserStories.js')).href}`);
  t.diagnostic('GREEN: both function exports; loadRules + loadExtensions + runChecker; all 7 existing fixtures pass');
});

test('absent build reports both attempted helper URLs and the build action', t => {
  const { root, rules, builder } = fixture(t);
  rmSync(join(builder, 'dist'), { recursive: true });
  const result = importRule(root, rules);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Build the model-builder/);
  for (const relative of ['../model-builder/dist/extraction/relations/featureUserStories.js', '../../model-builder/dist/extraction/relations/featureUserStories.js']) {
    assert.ok(result.stderr.includes(new URL(relative, pathToFileURL(join(rules, 'feature-user-stories.mjs'))).href), result.stderr);
  }
});

test('an existing helper must export the comparison function', t => {
  const { root, rules, builder } = fixture(t);
  writeFileSync(join(builder, 'dist/extraction/relations/featureUserStories.js'), 'export const compareFeatureUserStories = 42;\n');
  const result = importRule(root, rules);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must export compareFeatureUserStories as a function/);
});

test('an existing helper internal import failure is preserved rather than falling back', t => {
  const { root, rules } = fixture(t);
  const firstBuilder = join(root, 'tools/semantic-checker/model-builder');
  mkdirSync(join(firstBuilder, 'dist/extraction/relations'), { recursive: true });
  writeFileSync(join(firstBuilder, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(firstBuilder, 'dist/extraction/relations/featureUserStories.js'), "import './missing-internal-dependency.js';\n");
  const result = importRule(root, rules);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(result.stderr, /missing-internal-dependency.js/);
  assert.doesNotMatch(result.stderr, /Build the model-builder/);
});
