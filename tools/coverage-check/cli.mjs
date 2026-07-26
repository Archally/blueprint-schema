#!/usr/bin/env node
// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// coverage-check — does the blueprint still describe the code?
//
// Answers BOTH drift directions, which is the point. A tool that only lists matches reports
// nothing at all for the case that matters most — code that changed and no entity mentions:
//
//   code → model   Pass the paths you changed. Any path no entity references is listed under
//                  "Paths no entity references": code changed without a blueprint update.
//   model → code   With `--audit`, every `code_ref` is checked against disk. Refs pointing at
//                  files that are gone are the blueprint describing code that no longer exists.
//
// Cross-repo refs (`org/repo#path`, per the metamodel's code_ref_entry) cannot be checked from
// this clone. They are reported separately as unverifiable and NEVER counted as dangling.
//
// Matching is segment-aligned, never raw substring: querying `src/Cart` does not match
// `src/CartRule/...`. Every match row shows WHY it matched, so a surprising row can be audited.
//
// The analysis itself is NOT implemented here — it is `./analyze.mjs`, generated from the same
// TypeScript module `bp coverage-check` uses, so the two tools cannot answer differently.
// This file is only argument parsing, YAML harvesting and output.
//
// Usage:
//   node cli.mjs <path...> --model <dir> [--audit] [--code-root <dir>] [--strict] [--json]
//   node cli.mjs --model <dir> --audit                 # no paths: pure model→code audit
//
// Exit codes: 0 ok (or gaps without --strict) · 1 gaps with --strict · 2 usage/IO error
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { analyzeCoverage } from "./analyze.mjs";

const USAGE =
  "usage: coverage-check <path...> --model <dir> [--audit] [--code-root <dir>] [--strict] [--json] [--no-suffix]";

function fail(message) {
  console.error(`coverage-check: ${message}\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    paths: [],
    model: ".",
    codeRoot: ".",
    audit: false,
    strict: false,
    json: false,
    suffix: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--audit") args.audit = true;
    else if (token === "--strict") args.strict = true;
    else if (token === "--json") args.json = true;
    else if (token === "--no-suffix") args.suffix = false;
    else if (token === "--model") args.model = argv[++i];
    else if (token === "--code-root") args.codeRoot = argv[++i];
    else if (token === "--help" || token === "-h") { console.log(USAGE); process.exit(0); }
    else if (token.startsWith("-")) fail(`unknown flag: ${token}`);
    else args.paths.push(token);
  }
  return args;
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

/**
 * Harvest every object carrying a `code_refs` array, wherever it sits in the document.
 *
 * Two entity shapes exist in a blueprint and they identify themselves differently:
 *
 *   services:              ← LIST: the item carries its own `id`, and the key is the TYPE
 *     - id: SVC001
 *       code_refs: [...]
 *
 *   models:                ← MAP: the KEY is the identity (models carry `x-model-id`, not `id`),
 *     CreateOrderPayload:    and the grandparent key is the type
 *       code_refs: [...]
 *
 * Reading only `id`/`name` labels every map-shaped entity `(unnamed)` — 78 of them on the
 * PrestaShop example, which is most of its models. Hence `fromArray`.
 *
 * The TYPE is the containing YAML key, taken verbatim rather than guessed at. `bp coverage-check`
 * prints the model builder's type name (`Operation`) for the same entity; the ids and refs, which
 * are what you act on, are identical.
 */
function collectEntities(node, context, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectEntities(item, { ...context, fromArray: true }, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;

  if (Array.isArray(node.code_refs)) {
    const named = typeof node.id === "string" ? node.id : typeof node.name === "string" ? node.name : null;
    const fallback = context.fromArray ? "(unnamed)" : (context.key ?? "(unnamed)");
    out.push({
      id: named ?? fallback,
      type: (context.fromArray ? context.key : context.parentKey ?? context.key) ?? "?",
      refs: node.code_refs,
    });
  }
  for (const [key, value] of Object.entries(node)) {
    collectEntities(value, { key, fromArray: false, parentKey: context.key }, out);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.paths.length === 0 && !args.audit) fail("give at least one path, or --audit to check every code_ref");
if (!existsSync(args.model)) fail(`model directory not found: ${args.model}`);
const codeRoot = resolve(args.codeRoot);
if (args.audit && !existsSync(codeRoot)) fail(`--code-root does not exist: ${codeRoot}`);

const entities = [];
let fileCount = 0;
for (const file of walkYaml(args.model)) {
  let document;
  try {
    document = parseYaml(readFileSync(file, "utf8"));
  } catch {
    continue; // an unparseable file cannot contribute refs; validation is the validator's job
  }
  fileCount++;
  collectEntities(document, { key: null, fromArray: false, parentKey: null }, entities);
}

const report = analyzeCoverage({
  entities,
  paths: args.paths,
  allowSuffixMatch: args.suffix,
  refExists: args.audit ? (path) => existsSync(isAbsolute(path) ? path : join(codeRoot, path)) : undefined,
});

const gaps = report.uncoveredPaths.length + report.danglingRefs.length;
const exitCode = args.strict && gaps > 0 ? 1 : 0;

if (args.json) {
  console.log(JSON.stringify({ filesScanned: fileCount, codeRoot: args.audit ? codeRoot : null, ...report }, null, 2));
  process.exit(exitCode);
}

const lines = [`## Coverage check — ${args.model}`, ""];
if (report.totals.queries > 0) {
  lines.push(
    `Paths queried: ${report.totals.queries} · referenced by an entity: ${report.totals.coveredQueries} ` +
      `· unreferenced: ${report.uncoveredPaths.length}`,
  );
}
lines.push(`Entities with code_refs: ${report.totals.entitiesWithRefs} (${report.totals.refs} refs, ${fileCount} files)`);

if (report.matches.length > 0) {
  lines.push("", `### Matches (${report.matches.length})`, "");
  for (const match of report.matches) {
    lines.push(`- \`${match.queryPath}\` → \`${match.entityId}\` (${match.entityType}) via \`${match.refPath}\`` +
      ` [${match.role}, ${match.matchKind}]`);
  }
}

if (report.uncoveredPaths.length > 0) {
  lines.push(
    "",
    `### Paths no entity references (${report.uncoveredPaths.length})`,
    "",
    "Code changed without a blueprint update — model these, or record why they need no entity.",
    "",
    ...report.uncoveredPaths.map((path) => `- \`${path}\``),
  );
}

const DANGLING_SHOWN = 25;

if (report.danglingChecked) {
  lines.push("", `### Dangling code_refs (${report.danglingRefs.length}) — against ${codeRoot}`);
  if (report.danglingRefs.length === 0) {
    lines.push("", "Every same-repo code_ref resolves to a file that exists.");
  } else {
    const checkable = report.totals.refs - report.unverifiableRefs.length;
    if (report.danglingRefs.length === checkable && checkable >= 5) {
      // Every single ref missing is far more often a wrong --code-root than a blueprint that has
      // detached from its codebase entirely. Say so, rather than printing a wall of "drift".
      lines.push(
        "",
        `**Every checkable ref (${checkable}) is missing — is \`--code-root\` right?** It currently ` +
          `points at ${codeRoot}, and code_ref paths are resolved relative to it.`,
      );
    }
    lines.push("", "The blueprint points at source that is gone — moved, renamed or deleted.", "");
    for (const ref of report.danglingRefs.slice(0, DANGLING_SHOWN)) {
      lines.push(`- \`${ref.entityId}\` → \`${ref.refPath}\``);
    }
    if (report.danglingRefs.length > DANGLING_SHOWN) {
      lines.push(`- … and ${report.danglingRefs.length - DANGLING_SHOWN} more (use --json for the full list)`);
    }
  }
  if (report.unverifiableRefs.length > 0) {
    lines.push(
      "",
      `_${report.unverifiableRefs.length} cross-repo ref(s) (org/repo#path) cannot be checked from this clone ` +
        "and are excluded from the count above._",
    );
  }
}

if (gaps > 0 && !args.strict) {
  lines.push("", "_Coverage gaps are warnings — exit 0; use --strict to gate CI._");
}

console.log(lines.join("\n"));
process.exit(exitCode);
