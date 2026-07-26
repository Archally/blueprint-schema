// @ts-check
// Extraction tests for doc-snippet-validate.
//
// The extractor is the part that can fail SILENTLY: a fence it does not associate with a filename
// is skipped, and a skipped block is an unvalidated example that still teaches whoever reads it.
// So these cases are mostly about association — what counts as a declaration and what does not.
//
// End-to-end validation of the two historical RC5 shapes lives in `rc5-regression.test.mjs`, which
// needs a real schema tree.

import { test } from "node:test";
import assert from "node:assert/strict";
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
