// @ts-check
/**
 * Patch-mode scoping (plan D19): which files changed since a git ref.
 *
 * Untracked files are included deliberately — a newly authored slice is the single
 * most important thing a patch gate should judge, and it has no committed history.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string[]} output lines
 */
function git(args, cwd) {
  const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Absolute paths of files under `modelRoot` that differ from `ref` (including
 * uncommitted and untracked work).
 *
 * @param {string} modelRoot
 * @param {string} ref
 * @returns {Set<string>}
 * @throws when the ref is unknown or the directory is not a git repository
 */
export function changedFilesSince(modelRoot, ref) {
  const root = path.resolve(modelRoot);
  if (!fs.existsSync(root)) throw new Error(`model root does not exist: ${root}`);

  let repoRoot;
  try {
    [repoRoot] = git(['rev-parse', '--show-toplevel'], root);
  } catch {
    throw new Error(`--since requires a git repository; ${root} is not inside one`);
  }
  try {
    git(['rev-parse', '--verify', `${ref}^{commit}`], root);
  } catch {
    throw new Error(`--since ref not found: ${ref}`);
  }

  const relativePaths = [
    ...git(['diff', '--name-only', ref, '--', root], root),
    ...git(['ls-files', '--others', '--exclude-standard', '--', root], root),
  ];

  const changed = new Set();
  for (const relativePath of relativePaths) {
    const absolute = path.resolve(repoRoot, relativePath);
    // A deleted file has nothing to measure; keep only what is still on disk.
    if (absolute.startsWith(root + path.sep) && fs.existsSync(absolute)) {
      changed.add(absolute);
    }
  }
  return changed;
}
