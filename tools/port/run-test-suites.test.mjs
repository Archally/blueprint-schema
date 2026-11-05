import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const runner = fileURLToPath(new URL('./run-test-suites.mjs', import.meta.url));
function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'suite-runner-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return suites => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ testSuites: suites }));
    return spawnSync(process.execPath, [runner, join(root, 'package.json')], { encoding: 'utf8', timeout: 15000 });
  };
}
const group = (name, code = 0) => ({ name, argv: ['node', '-e', `console.log('MARKER:${name}'); console.log('# tests 1'); process.exit(${code});`] });
const results = output => output.split('\n').filter(line => line.startsWith('{"name":')).map(line => JSON.parse(line));

for (const codes of [[0, 1, 0], [1, 0, 1], [0, 0, 0]]) {
  test(`every suite reports its status for ${codes.join(',')}`, context => {
    const run = fixture(context);
    const child = run(codes.map((code, index) => group(`suite-${index}`, code)));
    assert.equal(child.status, codes.includes(1) ? 1 : 0, child.stderr);
    const summary = results(child.stdout);
    assert.deepEqual(summary.map(result => result.code), codes);
    assert.deepEqual(summary.map(result => result.status), codes.map(code => code ? 'failed' : 'passed'));
    for (let index = 0; index < codes.length; index++) assert.match(child.stdout, new RegExp(`MARKER:suite-${index}`));
  });
}

for (const [name, argv, extra] of [
  ['launch', ['missing-test-executable'], {}],
  ['signal', ['node', '-e', "process.kill(process.pid, 'SIGTERM')"], {}],
  ['timeout', ['node', '-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }],
  ['empty', ['node', '-e', "console.log('# tests 0')"], {}],
]) {
  test(`${name} fails but later group runs`, context => {
    const run = fixture(context);
    const child = run([{ name, argv, ...extra }, group('later')]);
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stdout, /MARKER:later/);
    const summary = results(child.stdout);
    assert.deepEqual(summary.map(result => result.status), ['failed', 'passed']);
    if (name === 'launch') assert.match(summary[0].error, /ENOENT/);
    if (name === 'signal') assert.equal(summary[0].signal, 'SIGTERM');
    if (name === 'timeout') assert.equal(summary[0].timedOut, true);
    if (name === 'empty') assert.equal(summary[0].tests, 0);
  });
}

test('empty, malformed, duplicate or invalid timeout configuration fails before launching', context => {
  const run = fixture(context);
  for (const configuration of [[], null, [{}], [group('same'), group('same')], [{ ...group('bad'), argv: ['node', 2] }], [{ ...group('bad'), timeoutMs: 0 }]]) {
    const child = run(configuration);
    assert.equal(child.status, 1);
    assert.doesNotMatch(child.stdout, /MARKER:/);
  }
});
