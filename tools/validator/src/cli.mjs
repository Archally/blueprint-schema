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
  const args = { model: path.resolve(".blueprint/v2.7"), schemas: null, compat: false };
  let schemasExplicit = false;

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
    } else if (token === "--compat" || token === "-c") {
      args.compat = true;
    } else if (!token.startsWith("-")) {
      args.model = path.resolve(token);
    }
  }

  if (!schemasExplicit) {
    const match = args.model.match(/v(\d+(?:\.\d+)?)/);
    const version = match ? `v${match[1]}` : null;
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
      "  --model, -m    Blueprint directory to validate (default: .blueprint/v2.7)",
      "  --schemas, -s  Schema version root (default: resolved from the model's declared version)",
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

  const errorCount = result.schemaErrors.length + result.crossErrors.length;
  if (errorCount > 0) {
    console.log(redBold(`FAILED with ${errorCount} error(s), ${result.warnings.length} warning(s).`));
    process.exit(1);
  }
  console.log(greenBold(`PASSED with ${result.warnings.length} warning(s).`));
}

main();
