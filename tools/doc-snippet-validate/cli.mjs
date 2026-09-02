#!/usr/bin/env node
// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// doc-snippet-validate — validate the YAML examples embedded in documentation.
//
// A worked example in a prompt or a guide is not decoration: it is the shape a reader (human or
// agent) will copy. When the schema moves and the example does not, the docs start teaching an
// invalid model — and nothing catches it, because no validator has ever been pointed at a
// markdown file.
//
// This is not hypothetical. The flagship example in this project's own modeling prompt drifted to
// **16 schema errors across 5 files** (plan RC5): `layout.slices` as a map instead of an array,
// `operations` as a list instead of a map, `goal` using `name`+`description` instead of
// `id`+`statement`+`priority`, an `enforcement` key on a `governed_by` reference. Every one of
// those cost a capacity-limited harness a wasted validation round, and every one is caught here.
//
// ── How it works ──────────────────────────────────────────────────────────────
// Fenced ```yaml blocks are extracted and grouped per markdown file, using the nearest preceding
// heading that names a file:
//
//     #### `.blueprint/repair-jobs/domain.yaml`
//
//     ```yaml
//     ...
//     ```
//
// The named blocks in one document are materialized into a temp directory as a real model, and the
// repository's OWN validator is run over it. Blocks with no filename heading are illustrative
// fragments — skipped, and counted in the report so the skip is never silent.
//
// Usage:
//   node cli.mjs <markdown...> --schemas <dir> [--validator "<template>"] [--keep] [--json]
//
// `--validator` is a command template; `{model}` and `{schemas}` are substituted. It defaults to
// the zero-build validator at `tools/validator/src/cli.mjs`; pass the path a checkout actually
// uses. Named explicitly rather than discovered: this tool must never guess which validator is
// authoritative for a checkout it did not lay out.
//
// Exit codes: 0 all documents valid · 1 a document failed · 2 usage/IO error
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { extractBlocks, modelRelativePath } from "./extract.mjs";

const DEFAULT_VALIDATOR = "node tools/validator/src/cli.mjs {model} --schemas {schemas}";
const USAGE =
  'usage: doc-snippet-validate <markdown...> --schemas <dir> [--validator "<template>"] [--keep] [--json] [--optional]';

function fail(message) {
  console.error(`doc-snippet-validate: ${message}\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { docs: [], schemas: undefined, validator: DEFAULT_VALIDATOR, keep: false, json: false, optional: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--optional") args.optional = true;
    else if (token === "--keep") args.keep = true;
    else if (token === "--json") args.json = true;
    else if (token === "--schemas") args.schemas = argv[++i];
    else if (token === "--validator") args.validator = argv[++i];
    else if (token === "--help" || token === "-h") { console.log(USAGE); process.exit(0); }
    else if (token.startsWith("-")) fail(`unknown flag: ${token}`);
    else args.docs.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.docs.length === 0) fail("give at least one markdown file");
if (!args.schemas) fail("--schemas <dir> is required");
if (!existsSync(args.schemas)) fail(`--schemas not found: ${args.schemas}`);
if (!args.validator.includes("{model}")) fail("--validator template must contain {model}");

const results = [];
let failed = 0;

for (const doc of args.docs) {
  if (!existsSync(doc)) {
    // Some listed documents live in a BUILD PRODUCT (the exported agent kit), not in this
    // repository — so they are absent in a fresh checkout and always absent in CI.
    //
    // `--optional` forgives an ABSENT TREE, never an absent file inside a tree that exists.
    // A blanket "missing means skip" would let a typo in the flagship document — the one this
    // gate exists for — pass as a skip, which is the silent-omission failure the gate prevents.
    // So the test is on the FIRST path segment: no `blueprint-ai-agent-kit/` at all means the kit
    // was never built here; a missing file inside a tree that DOES exist means a mistyped path.
    const treeRoot = doc.split(/[\\/]/)[0];
    if (args.optional && treeRoot && !existsSync(treeRoot)) {
      results.push({ doc, status: "skipped", reason: `no ${treeRoot}/ in this checkout (--optional)`, blocks: 0, unnamed: [] });
      continue;
    }
    fail(`not found: ${doc}`);
  }
  const { blocks, unnamed } = extractBlocks(readFileSync(doc, "utf8"));

  if (blocks.length === 0) {
    results.push({ doc, status: "skipped", reason: "no yaml block names a file", blocks: 0, unnamed });
    continue;
  }

  const root = mkdtempSync(join(tmpdir(), "doc-snippet-"));
  const written = new Map();
  let collision = null;
  for (const block of blocks) {
    const relative = modelRelativePath(block.path);
    if (written.has(relative)) {
      // Two blocks claiming the same file would silently overwrite, validating only the last one.
      collision = `${block.path} is declared twice (lines ${written.get(relative)} and ${block.line})`;
      break;
    }
    written.set(relative, block.line);
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${block.body}\n`, "utf8");
  }

  if (collision) {
    if (!args.keep) rmSync(root, { recursive: true, force: true });
    results.push({ doc, status: "failed", reason: collision, blocks: blocks.length, unnamed });
    failed++;
    continue;
  }

  const command = args.validator
    .replace("{model}", JSON.stringify(root))
    .replace("{schemas}", JSON.stringify(resolve(args.schemas)));
  const run = spawnSync(command, { shell: true, encoding: "utf8" });
  const ok = run.status === 0;
  if (!ok) failed++;

  results.push({
    doc,
    status: ok ? "passed" : "failed",
    blocks: blocks.length,
    unnamed,
    files: [...written.keys()],
    output: ok ? undefined : `${run.stdout ?? ""}${run.stderr ?? ""}`.trim(),
    kept: args.keep ? root : undefined,
  });

  if (!args.keep) rmSync(root, { recursive: true, force: true });
}

if (args.json) {
  console.log(JSON.stringify({ ok: failed === 0, checked: results.length, failed, results }, null, 2));
  process.exit(failed === 0 ? 0 : 1);
}

for (const result of results) {
  const mark = result.status === "passed" ? "OK  " : result.status === "skipped" ? "--  " : "FAIL";
  const detail = result.status === "skipped"
    ? result.reason
    : `${result.blocks} named block(s)${result.unnamed ? `, ${result.unnamed} unnamed skipped` : ""}`;
  console.log(`${mark} ${result.doc} — ${detail}`);
  if (result.reason && result.status === "failed") console.log(`     ${result.reason}`);
  if (result.output) {
    for (const line of result.output.split("\n")) console.log(`     ${line}`);
  }
  if (result.kept) console.log(`     extracted model kept at ${result.kept}`);
}

if (failed > 0) {
  console.error(`\n${failed} document(s) contain YAML that does not validate against the shipped schema.`);
  console.error("Fix the example — a doc that teaches an invalid shape costs every reader a failed round.");
}

process.exit(failed === 0 ? 0 : 1);
