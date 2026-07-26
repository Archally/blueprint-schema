#!/usr/bin/env node
// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// entity-query — search the model before minting a new entity.
//
// "Does this already exist?" is the cheapest question in modeling and the most expensive one to
// skip. A duplicate concept is valid YAML, passes every validator, and surfaces months later as
// two half-modelled versions of the same idea. This makes the search deterministic instead of a
// grep over 170 files.
//
// Reads a **built `model.json`** (from `blueprint-model`), not the YAML — the model builder already
// knows how to turn documents into typed entities, and a second extractor here would be a third
// implementation of that job, free to drift from both. Build once, query as often as you like.
//
// The filtering is NOT implemented here — it is `./search.mjs`, generated from the same TypeScript
// module `bp query` uses, so the two cannot rank or match differently.
//
// Usage:
//   node cli.mjs <model.json> [--text <q>] [--types a,b] [--layer <l>] [--tag <t>]
//                             [--limit <n>] [--json]
//
// Exit codes: 0 (matches, or a clean "no matches") · 1 no matches with --require-match · 2 usage/IO
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, statSync } from "node:fs";
import { searchEntities } from "./search.mjs";

const USAGE =
  "usage: entity-query <model.json> [--text <q>] [--types a,b] [--layer <l>] [--tag <t>] [--limit <n>] [--json] [--require-match]";

function fail(message) {
  console.error(`entity-query: ${message}\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { model: undefined, text: undefined, types: undefined, layer: undefined, tag: undefined, limit: 50, json: false, requireMatch: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--json") args.json = true;
    else if (token === "--require-match") args.requireMatch = true;
    else if (token === "--text") args.text = argv[++i];
    else if (token === "--types") args.types = argv[++i];
    else if (token === "--layer") args.layer = argv[++i];
    else if (token === "--tag") args.tag = argv[++i];
    else if (token === "--limit") args.limit = Number(argv[++i]);
    else if (token === "--help" || token === "-h") { console.log(USAGE); process.exit(0); }
    else if (token.startsWith("-")) fail(`unknown flag: ${token}`);
    else if (args.model === undefined) args.model = token;
    else fail(`unexpected argument: ${token}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.model) fail("a path to a built model.json is required");
if (!Number.isInteger(args.limit) || args.limit < 1) fail("--limit must be a positive integer");
if (!existsSync(args.model)) fail(`not found: ${args.model}`);

// Pointing this at a .blueprint/ directory is the obvious first mistake. Say what to run.
if (statSync(args.model).isDirectory()) {
  fail(
    `${args.model} is a directory. entity-query reads a BUILT model, not the YAML:\n` +
      `  npm run build && node tools/model-builder/dist/cli.js ${args.model} --output model.json\n` +
      "then query model.json.",
  );
}

let model;
try {
  model = JSON.parse(readFileSync(args.model, "utf8"));
} catch (error) {
  fail(`could not parse ${args.model} as JSON: ${error instanceof Error ? error.message : error}`);
}
if (!Array.isArray(model?.entities)) {
  fail(`${args.model} has no "entities" array — is it a model.json from blueprint-model?`);
}

const csv = (value) => (typeof value === "string" && value.trim() !== "" ? value.split(",") : undefined);

// `tags` live under `data` in the built model, exactly as `bp query` reads them.
const entities = model.entities.map((entity) => ({
  id: entity.id,
  displayId: entity.displayId,
  type: entity.type,
  layer: entity.layer,
  term: entity.term,
  summary: entity.summary,
  description: entity.description,
  tags: Array.isArray(entity.data?.tags) ? entity.data.tags.filter((tag) => typeof tag === "string") : undefined,
}));

const result = searchEntities(entities, {
  text: args.text,
  types: csv(args.types),
  layers: csv(args.layer),
  tags: csv(args.tag),
  limit: args.limit,
});

const exitCode = args.requireMatch && result.total === 0 ? 1 : 0;

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

if (result.total === 0) {
  console.log("No entities matched — nothing in the model describes this yet.");
  process.exit(exitCode);
}

const rows = result.hits.map((hit) => ({
  id: hit.entity.displayId ?? hit.entity.id,
  type: hit.entity.type,
  name: hit.entity.term ?? hit.entity.summary ?? "",
  layer: hit.entity.layer ?? "",
  matched: hit.matchField ?? "—",
}));
const width = (key) => Math.max(key.length, ...rows.map((row) => String(row[key]).length));
const columns = ["id", "type", "name", "layer", "matched"].map((key) => ({ key, width: width(key) }));
const line = (cells) => `| ${columns.map((column, i) => String(cells[i]).padEnd(column.width)).join(" | ")} |`;

console.log(`## ${result.total} match(es)\n`);
console.log(line(columns.map((column) => column.key.toUpperCase())));
console.log(`|${columns.map((column) => "-".repeat(column.width + 2)).join("|")}|`);
for (const row of rows) console.log(line(columns.map((column) => row[column.key])));
if (result.truncated > 0) console.log(`\n(showing ${result.hits.length}/${result.total} — raise --limit)`);

process.exit(exitCode);
