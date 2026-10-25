#!/usr/bin/env node
// @ts-check
//
// Copy the blueprint schema tree in beside the extension, so a packaged VSIX carries it.
//
// `contributes.yamlValidation` points at `./schema/**`, and a VSIX contains only what it packaged -
// it cannot reach into the repo the user happens to have open. The copy is therefore part of
// packaging, not a checked-in duplicate: it is gitignored, written by `vscode:prepublish`, and
// regenerated from whichever schema tree this checkout has.
//
// The source differs per repo, and that is the whole reason this searches rather than hardcodes.
// In the monorepo the schemas live under `schemas/blueprint/v{N}/schema`; in the publication repo
// they are `schema/v{N}` at the root. A script that assumed one would work in one repo and copy
// nothing in the other, which is the failure mode this file exists to avoid - so an unmatched
// search is a LOUD exit, never an empty copy.
//
// Usage: node sync-schema.mjs [--check]
// Exit 0 copied / in sync · 1 out of sync under --check · 2 no schema tree found.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = join(HERE, 'schema');

// Only v2.8 is bundled. Older versions require an explicit local diagnostic schema root.
const CANDIDATES = [
  '../../../schemas/blueprint/v2.8/schema', // monorepo
  '../../schema/v2.8', // publication repo
];

function findSource() {
  for (const candidate of CANDIDATES) {
    const path = resolve(HERE, candidate);
    if (existsSync(join(path, 'metamodel.schema.yaml'))) return path;
  }
  return null;
}

/** Every file under `dir`, as paths relative to it, sorted. */
function listFiles(dir, prefix = '') {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    const key = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(path).isDirectory()) found.push(...listFiles(path, key));
    else found.push(key);
  }
  return found;
}

function main() {
  const source = findSource();
  if (!source) {
    console.error(
      'sync-schema: no v2.8 schema tree found. Looked for `metamodel.schema.yaml` under:\n'
        + CANDIDATES.map((candidate) => `  ${resolve(HERE, candidate)}`).join('\n')
        + '\nThe extension cannot be packaged without one - `yamlValidation` would point at nothing.',
    );
    return 2;
  }

  const check = process.argv.includes('--check');
  const wanted = listFiles(source).filter((file) => file.endsWith('.yaml'));

  if (check) {
    const have = existsSync(DEST) ? listFiles(DEST).filter((file) => file.endsWith('.yaml')) : [];
    const differing = wanted.filter(
      (file) => !have.includes(file) || readFileSync(join(source, file), 'utf8') !== readFileSync(join(DEST, file), 'utf8'),
    );
    const extra = have.filter((file) => !wanted.includes(file));
    if (differing.length || extra.length) {
      console.error(`sync-schema: bundled copy is stale (${differing.length} differing, ${extra.length} extra). Run: node sync-schema.mjs`);
      return 1;
    }
    console.log(`sync-schema: in sync - ${wanted.length} schema file(s) from ${source}.`);
    return 0;
  }

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });
  for (const file of wanted) {
    mkdirSync(dirname(join(DEST, file)), { recursive: true });
    cpSync(join(source, file), join(DEST, file));
  }
  console.log(`sync-schema: copied ${wanted.length} schema file(s) from ${source}.`);
  return 0;
}

process.exitCode = main();
