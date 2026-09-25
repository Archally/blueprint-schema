#!/usr/bin/env node
// @ts-check
//
// Package this extension into a .vsix, working around a real `@vscode/vsce` failure mode in
// this monorepo: run `vsce package` from inside an npm workspace and it can walk the ENTIRE
// repository rather than just this folder - measured 2026-09-24, a run reached 48595 files
// (4.7 GB, including sibling package `../roadmap-gantt-preview` and the whole monorepo root)
// before being killed after 8 minutes with no output. `.vscodeignore` does not stop it: the
// runaway happens during vsce's own file-collection walk, upstream of where `.vscodeignore`
// patterns are applied.
//
// The workaround is to package from a copy of this folder that sits OUTSIDE any npm workspace,
// so vsce's workspace detection has nothing to walk into. `vscode:prepublish` (sync-schema +
// compile) still runs first, IN PLACE, against the real schema tree and TypeScript toolchain -
// only the packaging step itself moves to the isolated copy, using the already-built `out/` and
// `schema/`.
//
// Usage: node package-vsix.mjs [--no-dependencies] [vsce args...]
// Leaves the .vsix in this directory, named as vsce names it (archally-blueprint-navigation-<version>.vsix).

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));

function run(cmd, args, options = {}) {
  console.log(`+ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...options });
}

// 1. Build in place, against the real toolchain - this is the source of truth, and is what
//    `sync-schema.mjs --check` (the pre-commit gate) verifies against.
run('npm', ['run', 'sync-schema'], { cwd: HERE });
run('npm', ['run', 'compile'], { cwd: HERE });

// 2. Copy the built extension to a folder with no package.json above it, so vsce cannot detect
//    (or misdetect) an npm/yarn workspace.
const isolated = mkdtempSync(join(tmpdir(), 'blueprint-navigation-vsix-'));
try {
  run('rsync', [
    '-a',
    '--exclude', 'node_modules',
    '--exclude', '*.vsix',
    `${HERE}/`,
    `${isolated}/`,
  ]);

  // vsce always runs `vscode:prepublish` itself before packaging. The build already happened in
  // place (step 1); re-running it here would fail anyway, since `sync-schema.mjs`'s CANDIDATES are
  // relative to this file and the isolated copy sits at the wrong depth to find the monorepo's
  // schema tree. Replace it with a no-op that says so, rather than leaving a script that silently
  // does something different from what its name says.
  const isolatedPkgPath = join(isolated, 'package.json');
  const isolatedPkg = JSON.parse(readFileSync(isolatedPkgPath, 'utf8'));
  isolatedPkg.scripts['vscode:prepublish'] = 'echo skip: already built in place by package-vsix.mjs';
  writeFileSync(isolatedPkgPath, `${JSON.stringify(isolatedPkg, null, 2)}\n`);

  const vsceArgs = ['--yes', '@vscode/vsce', 'package', ...process.argv.slice(2)];
  run('npx', vsceArgs, { cwd: isolated });

  const vsixName = `${PKG.name}-${PKG.version}.vsix`;
  const producedPath = join(isolated, vsixName);
  if (!existsSync(producedPath)) {
    console.error(`package-vsix: expected ${vsixName} in ${isolated}, found nothing. vsce may have named it differently.`);
    process.exit(1);
  }
  cpSync(producedPath, join(HERE, vsixName));
  console.log(`package-vsix: wrote ${join(HERE, vsixName)}`);
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
