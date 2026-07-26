#!/usr/bin/env node
// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// next-id — allocate the next free typed id for a blueprint model.
//
// Answers "what id do I use next?" deterministically, so an authoring agent never has to guess
// or grep. Guessing is the single most expensive mistake a capacity-limited harness makes here:
// a reused id is valid YAML, passes the schema, and silently merges two entities in the graph.
//
// **Ids are GLOBAL per prefix.** `CAT001` used anywhere in the model — in any file, any context,
// any scope — makes `CAT001` unavailable everywhere. Scoping (`customers.SVC006`) is a namespace
// *within* that rule, not an escape from it. Asking for a bare prefix when every existing id is
// scoped is the classic misuse; the CLI prints a hint rather than handing back a colliding id.
//
// The allocation algorithm is NOT implemented here — it is `./allocate.mjs`, generated from the
// TypeScript module the monorepo CLIs already use, so this tool and `bp next-id` cannot drift.
// This file is only argument parsing, YAML harvesting and output.
//
// Usage:
//   node cli.mjs <PREFIX> --model <dir> [--scope <ns>] [--band <min>-<max>] [--count <n>] [--json]
//
// Exit codes: 0 allocated · 1 band exhausted · 2 usage/IO error
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { allocateNextId, collectIds, BandExhaustedError } from "./allocate.mjs";

const USAGE =
  "usage: next-id <PREFIX> --model <dir> [--scope <ns>] [--band <min>-<max>] [--count <n>] [--json]";

function parseArgs(argv) {
  const args = { prefix: undefined, model: ".", scope: undefined, band: undefined, count: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--json") args.json = true;
    else if (token === "--model") args.model = argv[++i];
    else if (token === "--scope") args.scope = argv[++i];
    else if (token === "--band") args.band = argv[++i];
    else if (token === "--count") args.count = Number(argv[++i]);
    else if (token === "--help" || token === "-h") { console.log(USAGE); process.exit(0); }
    else if (token.startsWith("-")) fail(`unknown flag: ${token}`);
    else if (args.prefix === undefined) args.prefix = token;
    else fail(`unexpected argument: ${token}`);
  }
  return args;
}

function fail(message) {
  console.error(`next-id: ${message}\n${USAGE}`);
  process.exit(2);
}

/** Every *.yaml under `dir`, recursively. */
function walkYaml(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue; // .quality/, .migrations/, .audit/ — not model source
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkYaml(path, found);
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) found.push(path);
  }
  return found;
}

const args = parseArgs(process.argv.slice(2));
if (!args.prefix) fail("a PREFIX is required (e.g. SVC, CMD, EVT)");
if (!Number.isInteger(args.count) || args.count < 1) fail("--count must be a positive integer");
if (!existsSync(args.model)) fail(`model directory not found: ${args.model}`);

let band;
if (args.band !== undefined) {
  const match = /^(\d+)-(\d+)$/.exec(args.band);
  if (!match) fail("--band must be <min>-<max>, e.g. --band 100-199");
  band = { min: Number(match[1]), max: Number(match[2]) };
}

// Harvest ids from EVERY document in the model — the global-uniqueness rule above depends on
// scanning all of them, not just the file being edited.
const ids = new Set();
let fileCount = 0;
for (const file of walkYaml(args.model)) {
  let document;
  try {
    document = parseYaml(readFileSync(file, "utf8"));
  } catch {
    continue; // an unparseable file cannot contribute ids; validation is the validator's job
  }
  fileCount++;
  collectIds(document, ids);
}

let result;
try {
  result = allocateNextId({ ids, prefix: args.prefix, namespace: args.scope, band, count: args.count });
} catch (error) {
  if (error instanceof BandExhaustedError) {
    console.error(`next-id: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

// DX hint (stderr, so it never pollutes an id being captured from stdout): a bare prefix with no
// matches, where scoped variants DO exist, almost always means --scope was forgotten.
if (!args.scope && !band && !args.json) {
  const escaped = args.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bare = new RegExp(`^${escaped}\\d+$`);
  const scoped = new RegExp(`^([A-Za-z0-9-]+)\\.${escaped}\\d+$`);
  let hasBare = false;
  const scopes = new Set();
  for (const id of ids) {
    if (bare.test(id)) hasBare = true;
    else {
      const match = id.match(scoped);
      if (match) scopes.add(match[1]);
    }
  }
  if (!hasBare && scopes.size > 0) {
    process.stderr.write(
      `hint: no bare ${args.prefix} ids in this model; scoped ${args.prefix} ids exist under ` +
        `[${[...scopes].sort().join(", ")}] — did you mean --scope <namespace>?\n`,
    );
  }
}

if (args.json) {
  const payload = Array.isArray(result) ? { ids: result } : { id: result };
  console.log(JSON.stringify({ ...payload, prefix: args.prefix, scope: args.scope ?? null, filesScanned: fileCount }));
} else {
  console.log(Array.isArray(result) ? result.join("\n") : result);
}
