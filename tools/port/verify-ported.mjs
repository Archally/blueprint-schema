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

// Published to <repo>/tools/port/ — the manifest sits beside this file, and the
// ported job directories are siblings one level up under tools/.
const PORT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = resolve(PORT_DIR, "..");
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
    const match = /^#\s*job\s+(\S+)\s+(\S+)\s*$/.exec(line.trim());
    if (match) dirs[match[1]] = match[2];
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
for (const [jobName, relativeDir] of Object.entries(JOB_DIRS)) {
  const dir = resolve(TOOLS_DIR, relativeDir);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).sort()) {
    if (name === "PORTED.sha256") continue; // the manifest is not one of its own entries
    const path = join(dir, name);
    if (statSync(path).isFile()) actual.set(`${jobName}/${name}`, hashNormalized(path));
  }
}

const problems = [];
for (const [file, hash] of actual) {
  if (!expected.has(file)) problems.push(`${file} is present but not in the manifest — added locally?`);
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
