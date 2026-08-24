#!/usr/bin/env node
// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// verify-ported — the PUBLIC half of the D24 port-parity check.
//
// The monorepo verifies that PORTED.sha256 still describes its canonical `.shared/`
// tree. This script is the other side: it verifies that the files shipped in THIS
// repo still match the manifest that was published with them. It needs no access to
// the monorepo, which is what makes public CI able to run it at all.
//
// What it catches: a local edit to a ported file (the common case — someone tweaks a
// rule in place instead of upstreaming it), a file added to or deleted from a ported
// directory, and a hand-edited manifest.
//
// Hashes cover LF-NORMALIZED content. Do not "fix" this to hash raw bytes: this repo
// has no .gitattributes, so `core.autocrlf=true` checks several files out as CRLF on
// Windows. A raw-byte manifest would pass in Linux CI and fail on every Windows
// contributor's machine.
//
// Zero dependencies, zero build — runnable on a bare `actions/setup-node`.
//
// Usage:  node tools/port/verify-ported.mjs [--json]
// Exit:   0 ok · 1 mismatch · 2 manifest missing or unreadable
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Published to <repo>/tools/port/ — the manifest sits beside this file. Job directories are
// resolved from the REPO ROOT, not from tools/: most ported units land under tools/, and at least
// one (the worked example model) does not. Resolving everything under tools/ silently sent every
// file of that unit to a path that cannot exist.
const PORT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = resolve(PORT_DIR, "..");
const REPO_ROOT = resolve(TOOLS_DIR, "..");
const MANIFEST_PATH = join(PORT_DIR, "PORTED.sha256");

/**
 * Manifest key prefix → directory holding those files, relative to tools/.
 *
 * Read from the manifest's own `# job <name> <dir>` header lines rather than hand-maintained here.
 * An earlier version kept a literal copy of the monorepo's job list; adding a job there and
 * forgetting it here reported every file of the new job as "missing from disk" — loud, but a
 * duplicate that had to be edited in two repos. The manifest already travels with the files, so it
 * is the natural place for the mapping.
 */
function readJobDirs(manifestText) {
  const dirs = {};
  for (const line of manifestText.split(/\r?\n/)) {
    const match = /^#\s*job\s+(\S+)\s+(\S+)(\s+extras-ok)?\s*$/.exec(line.trim());
    // `extras-ok` marks a unit that legitimately ships files this repo owns beside the ported ones
    // (a CLI entrypoint, a local index). Without it the verifier reports every such file as an
    // unauthorised local edit, and a gate that is wrong about known-good files gets switched off.
    if (match) dirs[match[1]] = { dir: match[2], extrasOk: Boolean(match[3]) };
  }
  return dirs;
}

const json = process.argv.includes("--json");

function hashNormalized(path) {
  return createHash("sha256")
    .update(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
}

if (!existsSync(MANIFEST_PATH)) {
  console.error(`No PORTED.sha256 in ${TOOLS_DIR} — this repo cannot verify its ported files.`);
  process.exit(2);
}

const manifestText = readFileSync(MANIFEST_PATH, "utf8");
const JOB_DIRS = readJobDirs(manifestText);
if (Object.keys(JOB_DIRS).length === 0) {
  console.error(`${MANIFEST_PATH} declares no \`# job <name> <dir>\` lines — re-emit it from the monorepo.`);
  process.exit(2);
}

const expected = new Map();
for (const line of manifestText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const match = trimmed.match(/^([0-9a-f]{64})\s+(.+)$/);
  if (match) expected.set(match[2], match[1]);
  else {
    console.error(`Unparseable manifest line: ${trimmed}`);
    process.exit(2);
  }
}

const actual = new Map();
const missingJobDirs = [];
for (const [jobName, { dir: relativeDir }] of Object.entries(JOB_DIRS)) {
  const dir = resolve(REPO_ROOT, relativeDir);
  // A declared job whose directory is absent is a BROKEN MANIFEST, not an empty job. Skipping it
  // quietly is what turned a path-resolution bug into 78 files reported as "missing from disk",
  // with nothing pointing at the directory that was never looked in.
  if (!existsSync(dir)) {
    missingJobDirs.push(`${jobName} -> ${relativeDir}`);
    continue;
  }
  // RECURSIVE, because the manifest is: a job's entries are keyed by the path relative to its own
  // directory (`model-builder/extraction/entities/arch.ts`), and a flat walk sees none of them.
  // A flat walk reports every nested file as missing from disk and every top-level file as added
  // locally, which is a report about the walk rather than about the repo.
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      if (name === "PORTED.sha256") continue; // the manifest is not one of its own entries
      const path = join(current, name);
      const key = prefix ? `${prefix}/${name}` : name;
      if (statSync(path).isDirectory()) walk(path, key);
      else actual.set(`${jobName}/${key}`, hashNormalized(path));
    }
  };
  walk(dir, "");
}

const problems = [];
for (const job of missingJobDirs) {
  problems.push(`job directory does not exist: ${job} — the manifest names a unit this repo does not have`);
}
for (const [file, hash] of actual) {
  if (!expected.has(file)) {
    if (!JOB_DIRS[file.slice(0, file.indexOf("/"))]?.extrasOk) {
      problems.push(`${file} is present but not in the manifest — added locally?`);
    }
  }
  else if (expected.get(file) !== hash) problems.push(`${file} has been modified since it was ported`);
}
for (const file of expected.keys()) {
  if (!actual.has(file)) problems.push(`${file} is in the manifest but missing from disk`);
}

if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, checked: actual.size, problems }, null, 2));
} else if (problems.length === 0) {
  console.log(`OK — ${actual.size} ported file(s) match PORTED.sha256.`);
} else {
  console.error(`${problems.length} problem(s) against PORTED.sha256:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nThese files are ported from the Archally monorepo and are not edited here.");
  console.error("Upstream the change instead, or re-port to pick up an intended update.");
}

process.exit(problems.length === 0 ? 0 : 1);
