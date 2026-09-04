#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════════════════
// Blueprint Model Validator — CLI wrapper
//
// The rule engine lives in `core/` and is layout-agnostic: it takes a model directory
// and a schema version root, and returns findings. THIS file is the only part that knows
// where those live on disk, which is why it is not part of the portable core.
//
// Checks performed (all in core/):
//   1) Per-file schema validation (Ajv draft-2020-12)
//   2) Cross-file reference integrity (typed IDs)
//   3) Gap warnings (operations without exchange, services without contracts) and
//      typed-id convention warnings for the infrastructure layer
//
// Usage:
//   node cli.mjs [PATH] [--model PATH] [--schemas PATH] [--compat]
//
// Exit codes: 0 = no errors (warnings may exist), 1 = errors, 2 = runner failure.
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateModel } from "./core/validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Colour, without a dependency. Enabled only on a terminal and only when `NO_COLOR` is unset, so
 * piped or redirected output stays plain text — which is what makes this command's output safe to
 * diff, parse, and compare between stacks.
 */
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (COLOR ? `[${code}m${text}[0m` : String(text));
const cyan = paint(36);
const red = paint(31);
const redBold = paint("1;31");
const yellow = paint(33);
const yellowBold = paint("1;33");
const green = paint(32);
const greenBold = paint("1;32");
const bold = paint(1);

/**
 * Schema roots live under different shapes depending on which checkout this runs in.
 * Both are tried, in this order, walking up from a starting directory.
 *
 * @param {string} version e.g. "v2.7"
 * @param {string} from    directory to start walking up from
 * @returns {string | null} the version root (its `schema/` subdir, if any, is found by the loader)
 */
function findSchemaRoot(version, from) {
  let dir = path.resolve(from);
  for (let i = 0; i < 12; i += 1) {
    const candidates = [
      path.join(dir, "schemas", "blueprint", version),
      path.join(dir, "schema", version),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * A version named as a whole path segment, minor optional. Anchored on a separator and a literal
 * `v` so a number anywhere else in the path - a build id, a temp directory - is never read as one.
 */
const VERSION_SEGMENT = /(?:^|[/\\])v(\d+)(?:\.(\d+))?(?=[/\\]|$)/g;

/** The LAST such segment: the version directory is the deepest part of a model path. */
function versionFromPath(value) {
  let found = null;
  if (typeof value !== "string") return null;
  for (const match of value.matchAll(VERSION_SEGMENT)) {
    found = { major: Number(match[1]), minor: match[2] === undefined ? null : Number(match[2]) };
  }
  return found;
}

/** The version a model DECLARES in its root file, or null. */
function versionFromDeclaration(modelDir) {
  try {
    const rootFile = path.join(modelDir, "blueprint.yaml");
    if (!fs.existsSync(rootFile)) return null;
    const declared = /^schemaVersion:\s*["']?(\d+)\.(\d+)/m.exec(fs.readFileSync(rootFile, "utf8"));
    return declared ? { major: Number(declared[1]), minor: Number(declared[2]) } : null;
  } catch {
    return null;
  }
}

/**
 * Which version this run judges the model by, and where that came from.
 *
 * Precedence, and the reason for each rung:
 *   1. `--schema-version`      an explicit caller override outranks anything discovered.
 *   2. the model path, WHEN it names a major AND a minor. A directory `v2.6` is a precise filing
 *      statement, and a declaration disagreeing with it is a defect for `bp validate` to WARN
 *      about, not something to silently resolve here.
 *   3. the model's own `schemaVersion:`, when the path names only a major. `.blueprint/v2` holding
 *      a model that declares `2.4.0` IS a 2.4 model - the declaration is the more specific fact and
 *      the directory is a legacy filing convention. Measured 2026-09-02: seven such models were
 *      being validated against a schema tree missing the very files they contain.
 *   4. the path's bare major, when nothing is declared.
 *
 * Returns null only when neither the path nor the model names one; the core then assumes current
 * semantics, and the header says so.
 */
function resolveVersion(modelDir, override) {
  const named = (v) => `v${v.major}.${v.minor}`;

  if (override) {
    return {
      version: { major: override.major, minor: override.minor },
      treeName: override.minorGiven ? named(override) : `v${override.major}`,
      source: "--schema-version",
    };
  }

  const fromPath = versionFromPath(modelDir);
  if (fromPath && fromPath.minor !== null) {
    return { version: fromPath, treeName: named(fromPath), source: "model path" };
  }

  const declared = versionFromDeclaration(modelDir);
  if (declared) {
    return {
      version: declared,
      treeName: named(declared),
      source: fromPath ? `blueprint.yaml (the path names only v${fromPath.major})` : "blueprint.yaml",
    };
  }

  if (fromPath) {
    return {
      version: { major: fromPath.major, minor: 0 },
      treeName: `v${fromPath.major}`,
      source: "model path (names no minor, and the model declares none)",
    };
  }
  return { version: null, treeName: null, source: "nothing declares one - current semantics assumed" };
}

const CONFIG_FILENAME = "validator.config.json";

/**
 * Configuration travels WITH the model — `.blueprint/validator.config.json`, a sibling of the
 * version directories it configures — so a repo carries its own answer and a fresh clone needs no
 * arguments. JSON rather than YAML deliberately: the model walk collects `*.yaml`, and a config
 * file that can be mistaken for model content is a defect waiting to happen.
 *
 * @returns {{file: string, config: Record<string, unknown>} | null}
 */
function loadConfig(modelDir) {
  const candidates = [
    path.join(path.dirname(modelDir), CONFIG_FILENAME),
    path.join(modelDir, CONFIG_FILENAME),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return { file, config: parsed && typeof parsed === "object" ? parsed : {} };
    } catch (err) {
      // An unreadable config is an error, never a silent fall-through to discovery: someone wrote
      // it down precisely so the answer would not be guessed.
      fail(`${file} is not valid JSON — ${err.message}`);
    }
  }
  return null;
}

function fail(message) {
  console.error(`Validation runner failed: ${message}`);
  process.exit(2);
}

/**
 * Where the schemas for `version` live. Sources are consulted most-specific first, and a source
 * that is DECLARED but unusable stops the run rather than quietly deferring to the next one.
 *
 * Every source is a local path. The validator never reaches the network: its verdict gates commits
 * and CI, so it must be reproducible and must not depend on what a host served today. Bringing
 * schemas onto the machine is a separate concern — clone, vendor, or install them.
 */
function resolveSchemaSource(modelDir, version) {
  const fromEnv = process.env.BLUEPRINT_SCHEMAS?.trim();
  if (fromEnv) {
    const resolved = pickVersionDir(path.resolve(fromEnv), version);
    if (!resolved) fail(`BLUEPRINT_SCHEMAS is set to "${fromEnv}" but no ${version ?? "schema"} directory was found there.`);
    return { root: resolved, source: "BLUEPRINT_SCHEMAS" };
  }

  const loaded = loadConfig(modelDir);
  if (loaded && typeof loaded.config.schemas === "string" && loaded.config.schemas.trim() !== "") {
    const base = path.resolve(path.dirname(loaded.file), loaded.config.schemas);
    const resolved = pickVersionDir(base, version);
    if (!resolved) fail(`${loaded.file} points "schemas" at "${loaded.config.schemas}" (${base}) but no ${version ?? "schema"} directory was found there.`);
    return { root: resolved, source: loaded.file };
  }

  if (!version) return null;
  // Convention: a checkout that already holds the schemas. Searched from the model outwards (a spec
  // repo standing on its own), then from this file, then from the working directory.
  const found =
    findSchemaRoot(version, modelDir) ??
    findSchemaRoot(version, __dirname) ??
    findSchemaRoot(version, process.cwd());
  return found ? { root: found, source: "layout discovery" } : null;
}

/** Accept either a directory OF versions (`<base>/v2.7`) or a version root itself. */
function pickVersionDir(base, version) {
  const candidates = version ? [path.join(base, version), base] : [base];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function parseArgs(argv) {
  const args = { model: path.resolve(".blueprint/v2.8"), schemas: null, compat: false, schemaVersion: null };
  let schemasExplicit = false;
  let versionOverride = null;

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if ((token === "--model" || token === "-m") && argv[i + 1]) {
      args.model = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((token === "--schemas" || token === "-s") && argv[i + 1]) {
      args.schemas = path.resolve(argv[i + 1]);
      schemasExplicit = true;
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    } else if (token === "--schema-version" && argv[i + 1]) {
      const parsed = /^v?(\d+)(?:\.(\d+))?/.exec(argv[i + 1]);
      if (!parsed) fail(`--schema-version expects a version like "2.6" or "v2.6", got "${argv[i + 1]}"`);
      versionOverride = {
        major: Number(parsed[1]),
        minor: parsed[2] === undefined ? 0 : Number(parsed[2]),
        minorGiven: parsed[2] !== undefined,
      };
      i += 1;
    } else if (token === "--compat" || token === "-c") {
      args.compat = true;
    } else if (!token.startsWith("-")) {
      args.model = path.resolve(token);
    }
  }

  // The version is resolved ONCE and drives both halves: which schema tree validates the model and
  // which version-conditioned rules fire. Deriving them separately is how they came to disagree -
  // this file matched a major-only directory and the core did not, so a `v2` model got the v2 tree
  // and current rules.
  const resolvedVersion = resolveVersion(args.model, versionOverride);
  args.schemaVersion = resolvedVersion.version;
  args.schemaVersionSource = resolvedVersion.source;

  if (!schemasExplicit) {
    const version = resolvedVersion.treeName;
    const resolved = resolveSchemaSource(args.model, version);
    if (!resolved) {
      fail(
        `no schemas found for ${version ?? "the model (no version in its path)"}. Searched, in order:\n` +
          `  1. --schemas <path>            (not given)\n` +
          `  2. BLUEPRINT_SCHEMAS           (not set)\n` +
          `  3. ${CONFIG_FILENAME}   (absent, or no "schemas" key) — looked beside and inside the model\n` +
          `  4. layout discovery            "schemas/blueprint/${version ?? "<version>"}" or ` +
          `"schema/${version ?? "<version>"}", walking up from the model, from the validator, and from the cwd\n` +
          `Schemas are never downloaded — put them on disk, or name their location with --schemas.`,
      );
    }
    args.schemas = resolved.root;
  } else {
    // An explicit --schemas may name a DIRECTORY OF VERSIONS or a version root, exactly as every
    // other source may. It used to be passed straight through: a container resolved to nothing,
    // every file was skipped, and the run reported PASSED on zero files validated. `pickVersionDir`
    // was already the answer and was simply not reached on this branch.
    args.schemas = pickVersionDir(args.schemas, resolvedVersion.treeName) ?? args.schemas;
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: validate-blueprint [PATH] [--model PATH] [--schemas PATH] [--compat]",
      "",
      "Validates blueprint YAML files against schemas and checks cross-references.",
      "",
      "Options:",
      "  --model, -m    Blueprint directory to validate (default: .blueprint/v2.8)",
      "  --schemas, -s  Schema version root (default: resolved from the model's declared version)",
      "  --schema-version  Judge the model as this version (e.g. 2.6), overriding path and declaration",
      "  --compat, -c   Relax schema failures to warnings — EXCEPT identity (`id`) and typed",
      "                 reference (`*_ref`) violations, which stay fatal in every mode",
      "  --help, -h     Show this help",
      "",
      "Checks performed:",
      "  1) Per-file schema validation (Ajv draft-2020-12)",
      "  2) Cross-file reference integrity (typed IDs)",
      "  3) Gap warnings (operations without exchange, services without contracts)",
    ].join("\n"),
  );
}

function main() {
  const args = parseArgs(process.argv);
  let result;
  try {
    result = validateModel(args);
  } catch (err) {
    console.error(`Validation runner failed: ${err.message}`);
    process.exit(2);
  }

  console.log(`${cyan("Model:")}     ${result.modelPath}`);
  console.log(`${cyan("Schemas:")}   ${args.schemas}`);
  console.log(
    `${cyan("Version:")}   ${
      args.schemaVersion ? `${args.schemaVersion.major}.${args.schemaVersion.minor}` : yellow("undetermined")
    } (${args.schemaVersionSource})`,
  );
  console.log(`${cyan("Mode:")}      ${args.compat ? yellow("compat") : "strict"}`);
  console.log(`${cyan("Files:")}     ${green(result.filesValidated)} validated, ${result.filesSkipped} skipped`);
  console.log("");

  const section = (label, items, colour, headerColour) => {
    if (items.length) {
      console.log(headerColour(`${label}:`));
      items.forEach((item) => console.log(colour(`  - ${item}`)));
    } else {
      console.log(`${bold(`${label}:`)} ${green("none")}`);
    }
    console.log("");
  };

  section("Schema Errors", result.schemaErrors, red, redBold);
  section("Cross-Reference Errors", result.crossErrors, red, redBold);
  section("Gap Warnings", result.warnings, yellow, yellowBold);

  // A run that recognised NO file shape has checked nothing, and "PASSED with 0 warnings" is the
  // wrong thing to tell its caller: the two outcomes are indistinguishable from the exit code, and
  // the silent one is the dangerous one. Measured 2026-09-02 on `.blueprint/v1` models: 0 validated,
  // 7 skipped, PASSED, exit 0.
  if (result.filesValidated === 0) {
    console.log(
      redBold(
        result.filesSkipped > 0
          ? `NO FILE VALIDATED. ${result.filesSkipped} file(s) were skipped because no schema in ` +
            `${args.schemas} matches their shape. This is not a pass - nothing was checked.`
          : `NO FILE VALIDATED. The model directory holds no file this validator recognises. ` +
            `This is not a pass - nothing was checked.`,
      ),
    );
    process.exit(2);
  }

  const errorCount = result.schemaErrors.length + result.crossErrors.length;
  if (errorCount > 0) {
    console.log(redBold(`FAILED with ${errorCount} error(s), ${result.warnings.length} warning(s).`));
    process.exit(1);
  }
  console.log(greenBold(`PASSED with ${result.warnings.length} warning(s).`));
}

main();
