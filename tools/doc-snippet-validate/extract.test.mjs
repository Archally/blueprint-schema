// @ts-check
// Extraction tests for doc-snippet-validate.
//
// The extractor is the part that can fail SILENTLY: a fence it does not associate with a filename
// is skipped, and a skipped block is an unvalidated example that still teaches whoever reads it.
// So these cases are mostly about association — what counts as a declaration and what does not.
//
// End-to-end validation of the two known drift shapes lives in `drift-shapes-fail.test.mjs`, which
// needs a real schema tree.

import { test, describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractBlocks, modelRelativePath } from "./extract.mjs";

test("associates a fence with the heading that names a file", () => {
  const { blocks, unnamed } = extractBlocks(
    ["#### `.blueprint/repair-jobs/domain.yaml`", "", "```yaml", "version: \"1.0.0\"", "```", ""].join("\n"),
  );
  assert.equal(unnamed, 0);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, ".blueprint/repair-jobs/domain.yaml");
  assert.equal(blocks[0].body, 'version: "1.0.0"');
  assert.equal(blocks[0].line, 4);
});

test("accepts a bold declaration as well as a heading", () => {
  const { blocks } = extractBlocks(["**`blueprint.yaml`**", "", "```yaml", "a: 1", "```"].join("\n"));
  assert.equal(blocks.length, 1);
});

test("counts an unnamed block instead of guessing a filename for it", () => {
  const { blocks, unnamed } = extractBlocks(["Some prose.", "", "```yaml", "a: 1", "```"].join("\n"));
  assert.equal(blocks.length, 0);
  assert.equal(unnamed, 1);
});

test("a filename mentioned in prose does not capture a later block", () => {
  // Without this, a sentence like "see `domain.yaml`" would silently claim the next fence and
  // validate an unrelated fragment as if it were a whole document.
  const { blocks, unnamed } = extractBlocks(
    ["#### `domain.yaml`", "", "Some prose between the heading and the fence.", "", "```yaml", "a: 1", "```"].join("\n"),
  );
  assert.equal(blocks.length, 0);
  assert.equal(unnamed, 1);
});

test("one heading claims only its own fence, not the next one too", () => {
  const { blocks, unnamed } = extractBlocks(
    ["#### `a.yaml`", "```yaml", "a: 1", "```", "```yaml", "b: 2", "```"].join("\n"),
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, "a.yaml");
  assert.equal(unnamed, 1);
});

test("an in-block `# file:` marker declares the path and is stripped from the YAML", () => {
  const { blocks, unnamed } = extractBlocks(
    ["### Causal chain pattern", "", "```yaml", "# file: .blueprint/shop/domain.yaml", "a: 1", "```"].join("\n"),
  );
  assert.equal(unnamed, 0);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, ".blueprint/shop/domain.yaml");
  assert.equal(blocks[0].body, "a: 1", "the marker must not reach the validator as YAML");
});

test("the marker only counts as the block's first line", () => {
  const { blocks, unnamed } = extractBlocks(
    ["```yaml", "a: 1", "# file: .blueprint/domain.yaml", "```"].join("\n"),
  );
  assert.equal(blocks.length, 0);
  assert.equal(unnamed, 1);
});

test("ignores non-yaml fences", () => {
  const { blocks, unnamed } = extractBlocks(
    ["#### `a.yaml`", "```bash", "echo hi", "```"].join("\n"),
  );
  assert.equal(blocks.length, 0);
  assert.equal(unnamed, 0);
});

test("handles yml as well as yaml, and an unterminated fence", () => {
  const { blocks } = extractBlocks(["#### `a.yml`", "```yml", "a: 1"].join("\n"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].body, "a: 1");
});

test("strips the .blueprint/ prefix so the temp dir is the model root", () => {
  assert.equal(modelRelativePath(".blueprint/repair-jobs/domain.yaml"), "repair-jobs/domain.yaml");
  assert.equal(modelRelativePath("./.blueprint/blueprint.yaml"), "blueprint.yaml");
  assert.equal(modelRelativePath("blueprint.yaml"), "blueprint.yaml");
  assert.equal(modelRelativePath(".blueprint\\a\\b.yaml"), "a/b.yaml");
});

// `--optional` exists because some listed documents live in a BUILD PRODUCT (the exported agent
// kit) rather than in this repository, so they are absent in every fresh checkout and in CI.
//
// The distinction it draws is the whole point. A blanket "missing means skip" would let a typo in
// the flagship document - the one this gate exists for - pass as a skip, which is precisely the
// silent-omission failure the gate prevents. So an absent TREE is forgiven and an absent FILE
// inside a tree that exists is not.
//
// Each case runs the CLI in a working directory the suite builds for itself, holding one tree
// that exists and one schema directory, so the outcome depends neither on where the tool is
// installed nor on the directory the tests are started from. The CLI checks `--schemas` before it
// reads any document and exits 2 when that directory is missing, so every assertion names the
// message of its own case: an exit 2 for a missing schema directory satisfies none of them.
describe("--optional forgives an absent tree, never a mistyped path", () => {
  const CLI = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");
  /** @type {string} */
  let workdir;
  /** @type {string} */
  let schemas;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), "doc-snippet-optional-"));
    mkdirSync(join(workdir, "existing-tree"));
    schemas = join(workdir, "schema");
    mkdirSync(schemas);
  });

  after(() => rmSync(workdir, { recursive: true, force: true }));

  /** @param {string[]} args */
  function run(args) {
    const result = spawnSync(process.execPath, [CLI, ...args, "--schemas", schemas], { cwd: workdir, encoding: "utf8" });
    return { code: result.status, out: (result.stdout ?? "") + (result.stderr ?? "") };
  }

  it("skips a document whose top-level tree is not checked out", () => {
    const result = run(["no-such-tree-here/claude-code/agent.md", "--optional"]);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /no-such-tree-here\/ in this checkout \(--optional\)/);
  });

  it("STILL fails on a missing file inside a tree that exists, even with --optional", () => {
    const result = run(["existing-tree/does-not-exist.md", "--optional"]);
    assert.equal(result.code, 2, result.out);
    assert.match(result.out, /^doc-snippet-validate: not found: existing-tree\/does-not-exist\.md$/m);
  });

  it("without --optional an absent tree is fatal too", () => {
    const result = run(["no-such-tree-here/claude-code/agent.md"]);
    assert.equal(result.code, 2, result.out);
    assert.match(result.out, /^doc-snippet-validate: not found: no-such-tree-here\/claude-code\/agent\.md$/m);
  });
});
