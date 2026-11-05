#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateSuites(suites) {
  if (!Array.isArray(suites) || suites.length === 0) throw new Error('testSuites must be a nonempty array');
  const names = new Set();
  for (const suite of suites) {
    if (!suite || typeof suite.name !== 'string' || !suite.name.trim() || names.has(suite.name)) {
      throw new Error('Every suite needs a unique nonempty name');
    }
    names.add(suite.name);
    if (!Array.isArray(suite.argv) || suite.argv.length === 0 || suite.argv.some(argument => typeof argument !== 'string' || !argument.length)) {
      throw new Error(`${suite.name}: argv must be a nonempty string array`);
    }
    if (suite.timeoutMs !== undefined && (!Number.isSafeInteger(suite.timeoutMs) || suite.timeoutMs < 1 || suite.timeoutMs > 3_600_000)) {
      throw new Error(`${suite.name}: timeoutMs must be between 1 and 3600000`);
    }
  }
}

function runSuite(suite, root) {
  return new Promise(resolveResult => {
    let output = '';
    let timedOut = false;
    let launchError;
    let timer;
    let child;
    try {
      const [command, ...argumentsList] = suite.argv;
      child = spawn(command === 'node' ? process.execPath : command, argumentsList, {
        cwd: root, shell: false, stdio: ['inherit', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolveResult({ name: suite.name, status: 'failed', error: error.message, tests: 0 });
      return;
    }
    // Forward both streams while retaining a bounded tail for standard test-count summaries.
    // This also rejects successful commands that discover no tests.
    const forward = destination => chunk => {
      destination.write(chunk);
      output = (output + chunk.toString()).slice(-131072);
    };
    child.stdout.on('data', forward(process.stdout));
    child.stderr.on('data', forward(process.stderr));
    child.on('error', error => { launchError = error.message; });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, suite.timeoutMs ?? 300_000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
      const nodeCount = /(?:^|\n)# tests (\d+)/m.exec(plain);
      const vitestCount = /(?:^|\n)\s*Tests\s+(.+)/m.exec(plain);
      const tests = nodeCount ? Number(nodeCount[1]) : vitestCount
        ? [...vitestCount[1].matchAll(/(\d+)\s+(?:passed|failed)/g)].reduce((total, match) => total + Number(match[1]), 0) : 0;
      const status = code === 0 && !signal && !launchError && !timedOut && tests > 0 ? 'passed' : 'failed';
      resolveResult({ name: suite.name, status, code, signal, timedOut, tests,
        ...(launchError ? { error: launchError } : {}),
        ...(tests === 0 ? { diagnostic: 'No executed tests reported' } : {}),
      });
    });
  });
}

export async function runSuites(suites, root) {
  validateSuites(suites);
  const results = [];
  for (const suite of suites) {
    console.log(`\nStarting suite: ${suite.name}`);
    const result = await runSuite(suite, root);
    results.push(result);
    console.log(`Suite ${suite.name}: ${result.status} (exit ${result.code ?? 'none'}, tests ${result.tests})`);
  }
  console.log('\nSuite summary');
  for (const result of results) console.log(JSON.stringify(result));
  return results.every(result => result.status === 'passed') ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const packagePath = resolve(process.argv[2] ?? 'package.json');
    const configuration = JSON.parse(readFileSync(packagePath, 'utf8'));
    process.exitCode = await runSuites(configuration.testSuites, dirname(packagePath));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
