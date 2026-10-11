#!/usr/bin/env node
// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// coverage-check - does the blueprint still describe the code?
//
// Answers BOTH drift directions, which is the point. A tool that only lists matches reports
// nothing at all for the case that matters most - code that changed and no entity mentions:
//
//   code → model   Pass the paths you changed. Any path no entity references is listed under
//                  "Paths no entity references": code changed without a blueprint update.
//   model → code   With `--audit`, every `code_ref` is checked against disk. Refs pointing at
//                  files that are gone are the blueprint describing code that no longer exists.
//
// Under `--audit` each repository the model names (`repository.url`, and every `repositories:`
// prefix for `org/repo#path` refs) is found on this machine by `./code-root.mjs`: `--code-root`
// for the primary repository, the model's own clone, the per-machine mapping file, or the
// repository holding a model that declares no URL. A ref whose repository has no root is reported
// as unverifiable with the reason and NEVER counted as dangling; a ref that is absolute or climbs
// out of its root is outside-root and never probed. A run in which no repository has a root is
// "not run", never a pass.
//
// Matching is segment-aligned, never raw substring: querying `src/Cart` does not match
// `src/CartRule/...`. Every match row shows WHY it matched, so a surprising row can be audited.
//
// The analysis and the root decision are NOT implemented here - they are `./analyze.mjs` and
// `./code-root.mjs`, generated from the same TypeScript modules `bp coverage-check` uses, so the
// two tools cannot answer differently. This file is only argument parsing, YAML harvesting, the
// file system and git, and output.
//
// Usage:
//   node cli.mjs <path...> --model <dir> [--audit] [--code-root <dir>] [--strict] [--json]
//   node cli.mjs --model <dir> --audit                 # no paths: pure model→code audit
//
// Exit codes: 0 ok (or gaps without --strict) · 1 gaps, or a check that did not run, with
// --strict · 2 usage/IO error
// ═══════════════════════════════════════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { analyzeCoverage } from "./analyze.mjs";
import {
  createRefChecker,
  formatCodeRootLine,
  formatRepositoryRootLine,
  mappingFileLocation,
  resolveCodeRoots,
} from "./code-root.mjs";

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
    /** @type {string | null} */
    codeRoot: null,
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
    if (entry.startsWith(".")) continue; // .quality/, .migrations/, .audit/ - not model source
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
 * Reading only `id`/`name` labels every map-shaped entity `(unnamed)`: 78 of them on the
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
// ── Where the code is (only under --audit) ──────────────────────────────────────────────────────
// The decision is `./code-root.mjs`; what follows supplies the file system, the mapping file and
// git. git runs as `git -C <dir> rev-parse --show-toplevel`, `git -C <dir> config --get-regexp
// '^remote\..*\.url$'` and, for a mapped clone, `rev-parse --abbrev-ref HEAD` and `rev-parse --short
// HEAD`, with argument arrays and no shell. The variables a git hook sets are removed, so `-C <dir>`
// always means the repository at that directory.

const GIT_ENV = { ...process.env };
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_PREFIX"]) delete GIT_ENV[name];

/** git's stdout, or `null` when git ran and failed; throws when git cannot be started at all. */
function git(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === "ENOENT" || code === "EACCES") throw new Error(`git is not available: ${error.message}`);
    return null;
  }
}

/** The file system and git, as `resolveCodeRoots` asks for them. */
const io = {
  isDirectory: (path) => { try { return statSync(path).isDirectory(); } catch { return false; } },
  remotesOf(dir) {
    if (!existsSync(dir)) return null;
    const topLevel = git(dir, ["rev-parse", "--show-toplevel"])?.trim();
    if (!topLevel) return null;
    const remotes = [];
    for (const line of (git(topLevel, ["config", "--get-regexp", "^remote\\..*\\.url$"]) ?? "").split("\n")) {
      const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
      if (match) remotes.push({ name: match[1], url: match[2] });
    }
    return { topLevel, remotes };
  },
  headOf: (dir) => ({
    branch: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() || null,
    shortSha: git(dir, ["rev-parse", "--short", "HEAD"])?.trim() || null,
  }),
};

/** The mapping file this machine names, read but never created. */
function readMapping() {
  const location = mappingFileLocation(process.env, homedir());
  const file = resolve(location.file);
  if (!existsSync(file)) return { file, explicit: location.explicit, state: "absent" };
  try {
    return { file, explicit: location.explicit, state: "parsed", data: parseYaml(readFileSync(file, "utf8")) };
  } catch (error) {
    return { file, explicit: location.explicit, state: "unreadable", error: String(error.message ?? error).split("\n")[0] };
  }
}

/** `repository:` and `repositories:` from the model's `blueprint.yaml`; neither when it is absent or unparseable. */
function readDeclarations(modelDir) {
  const isMap = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  let root = null;
  try {
    root = parseYaml(readFileSync(join(modelDir, "blueprint.yaml"), "utf8"));
  } catch {
    // no root file, or one that does not parse: the model declares no repository
  }
  return {
    repository: isMap(root) && isMap(root.repository) ? root.repository : null,
    repositories: isMap(root) && isMap(root.repositories) ? root.repositories : null,
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.paths.length === 0 && !args.audit) fail("give at least one path, or --audit to check every code_ref");
if (!existsSync(args.model)) fail(`model directory not found: ${args.model}`);
const codeRootFlag = args.codeRoot === null ? null : resolve(args.codeRoot);
if (args.audit && codeRootFlag !== null && !existsSync(codeRootFlag)) fail(`--code-root does not exist: ${codeRootFlag}`);

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

const modelDir = resolve(args.model);
const resolution = args.audit
  ? resolveCodeRoots(
      { modelDir, ...readDeclarations(modelDir), codeRootFlag, mapping: readMapping(), home: homedir() },
      io,
    )
  : null;

const report = analyzeCoverage({
  entities,
  paths: args.paths,
  allowSuffixMatch: args.suffix,
  checkRef: resolution ? createRefChecker(resolution, existsSync) : undefined,
});

const outsideRootRefs = report.outsideRootRefs ?? [];
const notRunReason = resolution?.notRunReason ?? null;
const gaps = report.uncoveredPaths.length + report.danglingRefs.length + outsideRootRefs.length;
const exitCode = args.strict && (gaps > 0 || notRunReason !== null) ? 1 : 0;

if (args.json) {
  const roots = resolution
    ? {
        codeRoot: resolution.codeRoot,
        codeRootSource: resolution.codeRootSource,
        repositoryRoots: resolution.repositoryRoots,
        resolverWarnings: resolution.resolverWarnings,
        notRunReason,
      }
    : { codeRoot: null };
  console.log(JSON.stringify({ filesScanned: fileCount, ...roots, ...report }, null, 2));
  process.exit(exitCode);
}

const lines = [`## Coverage check - ${args.model}`, ""];
if (resolution) {
  lines.push(formatCodeRootLine(resolution));
  for (const row of resolution.repositoryRoots.slice(1)) lines.push(formatRepositoryRootLine(row, resolution.mappingFile));
  for (const warning of resolution.resolverWarnings) lines.push(`Warning: ${warning}`);
  lines.push("");
}
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
    "Code changed without a blueprint update: model these, or record why they need no entity.",
    "",
    ...report.uncoveredPaths.map((path) => `- \`${path}\``),
  );
}

const LISTED = 25;

/** Up to LISTED refs; the overflow is stated, never silently dropped. */
function listRefs(refs) {
  for (const ref of refs.slice(0, LISTED)) lines.push(`- \`${ref.entityId}\` → \`${ref.refPath}\``);
  if (refs.length > LISTED) lines.push(`- … and ${refs.length - LISTED} more (use --json for the full list)`);
}

if (resolution && report.totals.refs > 0 && notRunReason !== null) {
  lines.push("", "### Dangling code_refs: not run", "", `Not run: ${notRunReason}.`);
} else if (resolution && report.totals.refs > 0) {
  const checkable = report.totals.refs - report.unverifiableRefs.length - outsideRootRefs.length;
  lines.push("", `### Dangling code_refs (${report.danglingRefs.length} of ${checkable} checked)`);
  if (checkable === 0) {
    lines.push("", "No code_ref could be checked; the reasons are below.");
  } else if (report.danglingRefs.length === 0) {
    lines.push("", "Every checked code_ref resolves to a file that exists.");
  } else {
    if (report.danglingRefs.length === checkable && checkable >= 5) {
      // Every single ref missing is far more often a wrong root than a blueprint that has
      // detached from its codebase entirely. Say so, rather than printing a wall of "drift".
      lines.push(
        "",
        `**Every checkable ref (${checkable}) is missing - is the code root right?** ` +
          `${formatCodeRootLine(resolution)}; code_ref paths are resolved relative to it.`,
      );
    }
    lines.push("", "The blueprint points at source that is gone: moved, renamed or deleted.", "");
    listRefs(report.danglingRefs);
  }
} else if (args.audit) {
  lines.push("", "_No refs to audit._");
}

if (outsideRootRefs.length > 0) {
  lines.push(
    "",
    `### code_refs outside their root (${outsideRootRefs.length})`,
    "",
    "Absolute, or climbing out of the repository with `..`: never checked, and a gap under --strict.",
    "",
  );
  listRefs(outsideRootRefs);
}

if (report.unverifiableRefs.length > 0) {
  // Grouped by reason, largest group first: one line per reason, not one per ref.
  const byReason = new Map();
  for (const ref of report.unverifiableRefs) {
    const reason = ref.reason ?? "cross-repo ref (org/repo#path) with no local root";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  lines.push("");
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`_${count} ref(s) cannot be checked: ${reason}._`);
  }
}

if ((gaps > 0 || notRunReason !== null) && !args.strict) {
  lines.push("", "_Coverage gaps and a check that did not run are warnings: exit 0; use --strict to gate CI._");
}

console.log(lines.join("\n"));
process.exit(exitCode);
