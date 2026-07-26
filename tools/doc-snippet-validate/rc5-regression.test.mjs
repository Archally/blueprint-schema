// @ts-check
// End-to-end regression: the historical RC5 drift shapes must FAIL, and their corrected forms must
// PASS. This is the test that makes the tool worth having — the extractor being right is necessary
// but not sufficient, since a tool that extracts perfectly and then validates nothing still ships
// a green build over broken docs (learned rule LR011: ship the heuristic with the input built to
// beat it).
//
// The shapes below are verbatim from the drift found in this project's own modeling prompt
// (plan RC5 / step-03 §7a, 16 schema errors across 5 files):
//
//   1. `layout.slices` as a map of layer→file — the pre-v2.6 shape. Must be an array.
//   2. `goal` with `name` + `description` — must be `id` + `statement` + `priority`, and the
//      schema is `additionalProperties: false`, so the old keys are hard errors.
//
// This file is ported verbatim to the public repo, where the validator lives at a different path
// under a different schema root — so it LOCATES the stack rather than being told about it. Env
// vars BLUEPRINT_SCHEMAS / BLUEPRINT_VALIDATOR override; absent both, it probes the two known
// layouts and skips loudly if neither is present.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "cli.mjs");

/** Walk up to the repo root (the directory holding package.json). */
function repoRoot() {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return HERE;
}

/** The two known validator stacks — public repo first, monorepo second. */
function detectStack() {
  const root = repoRoot();
  const candidates = [
    {
      validatorPath: join(root, "tools/validator/src/cli.mjs"),
      schemas: join(root, "schema/v2.7"),
      template: "node tools/validator/src/cli.mjs {model} --schemas {schemas}",
    },
    {
      validatorPath: join(root, "schemas/blueprint/v2.7/validation/validate-blueprint.mjs"),
      schemas: join(root, "schemas/blueprint/v2.7"),
      template:
        "node schemas/blueprint/v2.7/validation/validate-blueprint.mjs --model {model} --schemas {schemas}",
    },
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate.validatorPath) && existsSync(candidate.schemas)) {
      return { schemas: candidate.schemas, validator: candidate.template, cwd: root };
    }
  }
  return null;
}

const detected = detectStack();
const SCHEMAS = process.env.BLUEPRINT_SCHEMAS ?? detected?.schemas;
const VALIDATOR = process.env.BLUEPRINT_VALIDATOR ?? detected?.validator;
const CWD = detected?.cwd ?? process.cwd();
const READY = Boolean(SCHEMAS && VALIDATOR && existsSync(resolve(SCHEMAS)));

const BLUEPRINT_HEAD = [
  "#### `.blueprint/blueprint.yaml`",
  "",
  "```yaml",
  'version: "1.0.0"',
  'schemaVersion: "2.7.0"',
  'name: "Doc Snippet Fixture"',
  'description: "A fixture model used to prove the doc-snippet gate actually gates."',
  "layout:",
  "  mode: slices",
];

/** The corrected shapes — an array of slice names, and a schema-shaped goal. */
const GOOD = [
  ...BLUEPRINT_HEAD,
  "  slices: [shop]",
  "```",
  "",
  "#### `.blueprint/shop/motivation.yaml`",
  "",
  "```yaml",
  'version: "1.0.0"',
  "scope: shop",
  "goals:",
  "  - id: G001",
  '    statement: "Cut repair turnaround to under five working days."',
  "    priority: high",
  "```",
].join("\n");

/** RC5 shape 1: `slices` as a map of layer→file. */
const BAD_SLICES = GOOD.replace("  slices: [shop]", "  slices:\n    shop:\n      concepts: concepts.yaml");

/** RC5 shape 2: a goal carrying `name` + `description` instead of `statement` + `priority`. */
const BAD_GOAL = GOOD.replace(
  '  - id: G001\n    statement: "Cut repair turnaround to under five working days."\n    priority: high',
  '  - name: "Faster repairs"\n    description: "Cut repair turnaround to under five working days."',
);

function runOn(markdown) {
  const dir = mkdtempSync(join(tmpdir(), "rc5-"));
  const doc = join(dir, "example.md");
  writeFileSync(doc, markdown, "utf8");
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, doc, "--schemas", resolve(String(SCHEMAS)), "--validator", String(VALIDATOR)],
      // The validator template is written relative to the repo root, so run it from there.
      { encoding: "utf8", cwd: CWD },
    );
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the corrected example passes", { skip: READY ? false : "no validator stack found — set BLUEPRINT_SCHEMAS + BLUEPRINT_VALIDATOR" }, () => {
  const { code, out } = runOn(GOOD);
  assert.equal(code, 0, out);
});

test("RC5 shape 1 — layout.slices as a map — fails", { skip: READY ? false : "no validator stack found — set BLUEPRINT_SCHEMAS + BLUEPRINT_VALIDATOR" }, () => {
  const { code, out } = runOn(BAD_SLICES);
  assert.equal(code, 1, `expected a failure, got:\n${out}`);
});

test("RC5 shape 2 — goal with name+description — fails", { skip: READY ? false : "no validator stack found — set BLUEPRINT_SCHEMAS + BLUEPRINT_VALIDATOR" }, () => {
  const { code, out } = runOn(BAD_GOAL);
  assert.equal(code, 1, `expected a failure, got:\n${out}`);
});
