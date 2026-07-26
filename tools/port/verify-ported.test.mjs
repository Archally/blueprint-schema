// @ts-check
// Adversarial tests for verify-ported.mjs — the public-side D24 manifest check.
//
// Every case here is an input designed to DEFEAT the check, not to confirm it
// (learned rule LR011: a content heuristic ships with the input built to beat it, or
// it ships broken). The CRLF case is the one that matters most: a manifest over raw
// bytes passes in Linux CI and fails on every Windows contributor, which is precisely
// the failure this tool must not have.
//
// Hermetic — builds a throwaway repo layout in tmp; never touches a real clone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "verify-ported.mjs");

const hash = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");

/**
 * Build a fixture: <tmp>/tools/{quality-gate,semantic-checker/rules,port}/ plus a
 * manifest generated from `files`. Returns the path to the copied verifier.
 * `manifestOverride` lets a test publish a manifest that disagrees with disk.
 */
function makeFixture(files, manifestOverride) {
  const root = mkdtempSync(join(tmpdir(), "verify-ported-"));
  const toolsDir = join(root, "tools");
  const portDir = join(toolsDir, "port");
  mkdirSync(join(toolsDir, "quality-gate"), { recursive: true });
  mkdirSync(join(toolsDir, "semantic-checker", "rules"), { recursive: true });
  mkdirSync(portDir, { recursive: true });

  const dirFor = {
    "quality-gate": join(toolsDir, "quality-gate"),
    "semantic-rules": join(toolsDir, "semantic-checker", "rules"),
    port: portDir,
  };

  const lines = [];
  for (const [key, content] of Object.entries(files)) {
    const [job, name] = key.split("/");
    writeFileSync(join(dirFor[job], name), content, "utf8");
    lines.push(`${hash(content)}  ${key}`);
  }

  const verifier = join(portDir, "verify-ported.mjs");
  copyFileSync(SOURCE, verifier);
  // The verifier is itself a ported file, so it belongs in the manifest.
  lines.push(`${hash(readFileSync(verifier, "utf8"))}  port/verify-ported.mjs`);

  // The verifier reads its job→directory map from these header lines, exactly as the real
  // manifest carries them — so a fixture without them is testing a manifest that cannot be read.
  const header = [
    "# PORTED.sha256 — test fixture",
    "# job quality-gate quality-gate",
    "# job semantic-rules semantic-checker/rules",
    "# job port port",
  ];
  writeFileSync(
    join(portDir, "PORTED.sha256"),
    `${[...header, ...(manifestOverride ?? lines)].join("\n")}\n`,
    "utf8",
  );
  return { root, verifier, portDir, dirFor };
}

function run(verifier) {
  const result = spawnSync(process.execPath, [verifier], { encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const BASE = {
  "quality-gate/collect.mjs": "export const collect = () => [];\n",
  "semantic-rules/orphan-entities.yaml": "rules:\n  - id: orphan-entities\n    severity: warn\n",
};

test("clean fixture verifies", () => {
  const { root, verifier } = makeFixture(BASE);
  try {
    const { code, out } = run(verifier);
    assert.equal(code, 0, out);
    assert.match(out, /3 ported file\(s\) match/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a content edit to a ported file is caught", () => {
  const { root, verifier, dirFor } = makeFixture(BASE);
  try {
    writeFileSync(join(dirFor["semantic-rules"], "orphan-entities.yaml"), "rules:\n  - id: tampered\n", "utf8");
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    assert.match(out, /orphan-entities\.yaml has been modified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a CRLF-only checkout still verifies — the Windows/Linux trap", () => {
  const { root, verifier, dirFor } = makeFixture(BASE);
  try {
    const path = join(dirFor["semantic-rules"], "orphan-entities.yaml");
    const asCrlf = readFileSync(path, "utf8").replace(/\r?\n/g, "\r\n");
    writeFileSync(path, asCrlf, "utf8");
    assert.ok(asCrlf.includes("\r\n"), "fixture must actually contain CRLF");
    const { code, out } = run(verifier);
    assert.equal(code, 0, out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a file added locally is caught", () => {
  const { root, verifier, dirFor } = makeFixture(BASE);
  try {
    writeFileSync(join(dirFor["semantic-rules"], "local-rule.yaml"), "rules: []\n", "utf8");
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    assert.match(out, /local-rule\.yaml is present but not in the manifest/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a deleted ported file is caught", () => {
  const { root, verifier, dirFor } = makeFixture(BASE);
  try {
    rmSync(join(dirFor["quality-gate"], "collect.mjs"));
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    assert.match(out, /collect\.mjs is in the manifest but missing from disk/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a hand-edited manifest hash is caught", () => {
  const bogus = `${"0".repeat(64)}  quality-gate/collect.mjs`;
  const { root, verifier } = makeFixture(BASE, [bogus]);
  try {
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    // The other real files are now absent from the manifest, so they surface too.
    assert.match(out, /collect\.mjs has been modified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a malformed manifest line fails loudly rather than being skipped", () => {
  const { root, verifier } = makeFixture(BASE, ["not-a-hash  quality-gate/collect.mjs"]);
  try {
    const { code, out } = run(verifier);
    assert.equal(code, 2);
    assert.match(out, /Unparseable manifest line/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a manifest with no job lines exits 2 rather than reporting everything missing", () => {
  // Before the job map moved into the manifest, the verifier carried a hand-written copy of the
  // monorepo's job list. Adding a job in one repo and not the other reported every file of the new
  // job as "missing from disk" — a true statement about the wrong thing. A manifest that declares
  // no jobs is now an explicit "re-emit me", not a pile of phantom mismatches.
  const { root, verifier, portDir } = makeFixture(BASE);
  try {
    const text = readFileSync(join(portDir, "PORTED.sha256"), "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("# job "))
      .join("\n");
    writeFileSync(join(portDir, "PORTED.sha256"), text, "utf8");
    const { code, out } = run(verifier);
    assert.equal(code, 2);
    assert.match(out, /declares no `# job/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a missing manifest exits 2, distinct from a mismatch", () => {
  const { root, verifier, portDir } = makeFixture(BASE);
  try {
    rmSync(join(portDir, "PORTED.sha256"));
    const { code, out } = run(verifier);
    assert.equal(code, 2);
    assert.match(out, /cannot verify its ported files/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
