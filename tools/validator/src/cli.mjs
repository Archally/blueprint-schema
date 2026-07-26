#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { validateModel } from "./validate.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {
    model: path.resolve(".blueprint/v2.7"),
    schemas: path.resolve(__dirname, "..", "..", "..", "schema", "v2.7"),
    compat: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if ((token === "--model" || token === "-m") && argv[i + 1]) {
      args.model = path.resolve(argv[i + 1]);
      i += 1;
    } else if ((token === "--schemas" || token === "-s") && argv[i + 1]) {
      args.schemas = path.resolve(argv[i + 1]);
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
  if (!argv.includes("--schemas") && !argv.includes("-s")) {
    const versionMatch = args.model.match(/v(\d+\.\d+)/);
    if (versionMatch) {
      const detected = path.resolve(__dirname, "..", "..", "..", "schema", `v${versionMatch[1]}`);
      if (fs.existsSync(detected)) {
        args.schemas = detected;
      }
    }
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: blueprint-validate [PATH] [--model PATH] [--schemas PATH] [--compat]",
      "",
      "Validates blueprint YAML files against schemas and checks cross-references.",
      "",
      "Options:",
      "  --model, -m    Blueprint directory to validate (default: .blueprint/v2.7)",
      "  --schemas, -s  Schema version root directory (default: auto-detected from model path)",
      "  --compat, -c   Relax schema failures to warnings — EXCEPT identity (`id`) and typed",
      "                 reference (`*_ref`) violations, which stay fatal in every mode",
      "  --help, -h     Show this help",
      "",
      "Checks performed:",
      "  1) Per-file schema validation (Ajv draft-2020-12)",
      "  2) Cross-file reference integrity (typed IDs)",
      "  3) Gap warnings (orphan entities, missing planes)",
    ].join("\n"),
  );
}

function main() {
  const args = parseArgs(process.argv);
  let result;
  try {
    result = validateModel(args);
  } catch (err) {
    console.error(chalk.red(`Validation runner failed: ${err.message}`));
    process.exit(2);
  }

  console.log(`${chalk.cyan("Model:")}     ${result.modelPath}`);
  console.log(`${chalk.cyan("Schemas:")}   ${args.schemas}`);
  console.log(`${chalk.cyan("Mode:")}      ${args.compat ? chalk.yellow("compat") : "strict"}`);
  console.log(`${chalk.cyan("Files:")}     ${chalk.green(result.filesValidated)} validated, ${result.filesSkipped} skipped`);
  console.log("");

  if (result.schemaErrors.length) {
    console.log(chalk.red.bold("Schema Errors:"));
    result.schemaErrors.forEach((e) => console.log(chalk.red(`  - ${e}`)));
    console.log("");
  } else {
    console.log(`${chalk.bold("Schema Errors:")} ${chalk.green("none")}`);
    console.log("");
  }

  if (result.crossErrors.length) {
    console.log(chalk.red.bold("Cross-Reference Errors:"));
    result.crossErrors.forEach((e) => console.log(chalk.red(`  - ${e}`)));
    console.log("");
  } else {
    console.log(`${chalk.bold("Cross-Reference Errors:")} ${chalk.green("none")}`);
    console.log("");
  }

  if (result.warnings.length) {
    console.log(chalk.yellow.bold("Gap Warnings:"));
    result.warnings.forEach((w) => console.log(chalk.yellow(`  - ${w}`)));
    console.log("");
  } else {
    console.log(`${chalk.bold("Gap Warnings:")} ${chalk.green("none")}`);
    console.log("");
  }

  const errorCount = result.schemaErrors.length + result.crossErrors.length;
  if (errorCount > 0) {
    console.log(chalk.red.bold(`FAILED with ${errorCount} error(s), ${result.warnings.length} warning(s).`));
    process.exit(1);
  }
  console.log(chalk.green.bold(`PASSED with ${result.warnings.length} warning(s).`));
}

main();
