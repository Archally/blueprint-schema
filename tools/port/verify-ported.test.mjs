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

  const exampleDir = join(root, "examples", "prestashop", ".blueprint", "v2.8");
  mkdirSync(exampleDir, { recursive: true });

  const dirFor = {
    "quality-gate": join(toolsDir, "quality-gate"),
    "semantic-rules": join(toolsDir, "semantic-checker", "rules"),
    port: portDir,
    "example-model": exampleDir,
  };

  const lines = [];
  for (const [key, content] of Object.entries(files)) {
    const slash = key.indexOf("/");
    const [job, name] = [key.slice(0, slash), key.slice(slash + 1)];
    const target = join(dirFor[job], name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
    lines.push(`${hash(content)}  ${key}`);
  }

  const verifier = join(portDir, "verify-ported.mjs");
  copyFileSync(SOURCE, verifier);
  // The verifier is itself a ported file, so it belongs in the manifest.
  lines.push(`${hash(readFileSync(verifier, "utf8"))}  port/verify-ported.mjs`);

  // The verifier reads its job→directory map from these header lines, exactly as the real
  // manifest carries them — so a fixture without them is testing a manifest that cannot be read.
  // Job directories are relative to the REPO ROOT, so a unit outside `tools/` is expressible.
  // `example-model` is that case, and it is the one the old fixture could not write down: every
  // job it declared lived under `tools/`, so a verifier that resolved everything under `tools/`
  // passed every test while reporting a real unit's entire contents as missing from disk.
  const header = [
    "# PORTED.sha256 — test fixture",
    "# job quality-gate tools/quality-gate",
    "# job semantic-rules tools/semantic-checker/rules",
    "# job port tools/port",
    "# job example-model examples/prestashop/.blueprint/v2.8",
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
  // A unit deployed OUTSIDE `tools/`. Present in BASE rather than in one dedicated test, so every
  // assertion below covers it: the failure it guards against was not that the outside-tools case
  // behaved wrongly, but that no case exercised it at all.
  "example-model/blueprint.yaml": "schemaVersion: '2.7.0'\n",
  // NESTED, because the manifest keys nested paths and a flat walk sees none of them - it reports
  // every nested file as missing from disk and every top-level one as added locally, which is a
  // report about the walk rather than about the repo.
  "example-model/orders/story.yaml": "stories: []\n",
};

test("clean fixture verifies", () => {
  const { root, verifier } = makeFixture(BASE);
  try {
    const { code, out } = run(verifier);
    assert.equal(code, 0, out);
    assert.match(out, /5 ported file\(s\) match/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a nested file is checked, not reported as missing", () => {
  const { root, verifier, dirFor } = makeFixture(BASE);
  try {
    writeFileSync(join(dirFor["example-model"], "orders", "story.yaml"), "stories: [tampered]\n", "utf8");
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    assert.match(out, /example-model\/orders\/story\.yaml has been modified/);
    assert.doesNotMatch(out, /missing from disk/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A unit WITHOUT `extras-ok` must still report a stray file - otherwise the flag would be doing
// nothing and the test above would pass with the check removed entirely.
test("a file with no manifest entry is reported when the unit is not extras-ok", () => {
  const { root, verifier, dirFor } = makeFixture(BASE);
  try {
    writeFileSync(join(dirFor["quality-gate"], "local-only.mjs"), "export const x = 1;\n", "utf8");
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    assert.match(out, /quality-gate\/local-only\.mjs is present but not in the manifest/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a unit marked extras-ok may ship files the manifest does not name", () => {
  const { root, verifier, dirFor, portDir } = makeFixture(BASE);
  try {
    const manifest = join(portDir, "PORTED.sha256");
    writeFileSync(manifest,
      readFileSync(manifest, "utf8").replace("# job example-model examples/prestashop/.blueprint/v2.8",
        "# job example-model examples/prestashop/.blueprint/v2.8 extras-ok"), "utf8");
    writeFileSync(join(dirFor["example-model"], "cli.ts"), "export {};\n", "utf8");
    const { code, out } = run(verifier);
    assert.equal(code, 0, out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a content edit is caught in a unit deployed OUTSIDE tools/", () => {
  const { root, verifier, dirFor } = makeFixture(BASE);
  try {
    writeFileSync(join(dirFor["example-model"], "blueprint.yaml"), "schemaVersion: '9.9.9'\n", "utf8");
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    assert.match(out, /example-model\/blueprint\.yaml has been modified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A job directory that is not there is a broken manifest, and used to be skipped in silence - which
// is how a path-resolution bug presented as every file of the unit "missing from disk", with nothing
// naming the directory that was never looked in.
test("a job directory that does not exist is named, not skipped", () => {
  const { root, verifier } = makeFixture(BASE);
  try {
    rmSync(join(root, "examples"), { recursive: true, force: true });
    const { code, out } = run(verifier);
    assert.equal(code, 1);
    assert.match(out, /job directory does not exist: example-model/);
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
