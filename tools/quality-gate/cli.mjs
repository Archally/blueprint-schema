#!/usr/bin/env node
// @ts-check
/**
 * Blueprint quality gate — the deterministic feedback loop for the dimensions the
 * validator and the semantic checker do not measure (plan step-01).
 *
 * Zero-build, one runtime dependency (`yaml`), path-argument-driven: the same files
 * run from this repo and from the public repo's `tools/quality-gate/` (plan D18).
 *
 * Usage:
 *   node cli.mjs <modelRoot> [<modelRoot> ...] [options]
 *
 * Options:
 *   --strict              exit 1 on any threshold or baseline breach
 *   --since <git-ref>     patch mode: score only entities in files changed since ref
 *   --json [file]         machine-readable output (stdout when no file given)
 *   --spec <file>         alternative quality spec
 *   --config <file>       alternative project config (default: .blueprint-quality.yaml)
 *   --update-baseline     write the current scores back as the ratchet baseline
 *   --worst <n>           worst-file rows to print (default 15)
 *   --quiet               suppress the text report
 *
 * Exit codes: 0 = clean, 1 = breach in --strict, 2 = usage or runtime error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectObservations } from './collect.mjs';
import { evaluate, nextBaseline } from './evaluate.mjs';
import { renderReport } from './report.mjs';
import { changedFilesSince } from './git-changes.mjs';
import { loadSpec, loadProjectConfig, writeBaseline, PROJECT_CONFIG_NAME } from './config.mjs';

const USAGE = 'usage: node cli.mjs <modelRoot> [more roots] [--strict] [--since <ref>] [--json [file]] [--spec <file>] [--config <file>] [--update-baseline] [--worst <n>] [--quiet]';

/** @param {string[]} argv */
export function parseArguments(argv) {
  /** @type {{roots: string[], strict: boolean, since?: string, json: boolean, jsonFile?: string, spec?: string, config?: string, updateBaseline: boolean, worst: number, quiet: boolean}} */
  const options = { roots: [], strict: false, json: false, updateBaseline: false, worst: 15, quiet: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case '--strict': options.strict = true; break;
      case '--update-baseline': options.updateBaseline = true; break;
      case '--quiet': options.quiet = true; break;
      case '--since': options.since = argv[++index]; break;
      case '--spec': options.spec = argv[++index]; break;
      case '--config': options.config = argv[++index]; break;
      case '--worst': options.worst = Number(argv[++index]); break;
      case '--json': {
        options.json = true;
        const next = argv[index + 1];
        if (next && !next.startsWith('--')) options.jsonFile = argv[++index];
        break;
      }
      case '-h':
      case '--help': throw new Error(USAGE);
      default:
        if (argument.startsWith('--')) throw new Error(`unknown option: ${argument}\n${USAGE}`);
        options.roots.push(argument);
    }
  }
  if (options.roots.length === 0) throw new Error(USAGE);
  if (options.since && options.updateBaseline) {
    throw new Error('--update-baseline measures the whole model and cannot be combined with --since');
  }
  return options;
}

/**
 * Score one model root.
 * @param {string} modelRoot
 * @param {ReturnType<typeof parseArguments>} options
 * @param {object} spec
 */
function runOne(modelRoot, options, spec) {
  const resolvedRoot = path.resolve(modelRoot);
  if (!fs.existsSync(resolvedRoot)) throw new Error(`model root does not exist: ${resolvedRoot}`);

  const { observations, parseErrors, fileCount, schemaVersion } = collectObservations(resolvedRoot);
  const { config, path: configPath } = loadProjectConfig(resolvedRoot, options.config);
  const changedFiles = options.since ? changedFilesSince(resolvedRoot, options.since) : undefined;

  const result = evaluate({ observations, spec, config, changedFiles, schemaVersion });

  if (options.updateBaseline) {
    const target = configPath ?? path.join(resolvedRoot, PROJECT_CONFIG_NAME);
    writeBaseline(target, nextBaseline(result, config.baseline ?? {}));
    if (!options.quiet) console.log(`  baseline written: ${target}`);
  }

  return { modelRoot: resolvedRoot, result, fileCount, parseErrors, configPath };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message));
    process.exit(2);
  }

  let spec;
  try {
    ({ spec } = loadSpec(options.spec));
  } catch (error) {
    console.error(String(error.message));
    process.exit(2);
  }

  const runs = [];
  for (const modelRoot of options.roots) {
    try {
      runs.push(runOne(modelRoot, options, spec));
    } catch (error) {
      console.error(`error scanning ${modelRoot}: ${String(error.message)}`);
      process.exit(2);
    }
  }

  if (!options.quiet && !(options.json && !options.jsonFile)) {
    for (const run of runs) {
      console.log(renderReport({
        modelRoot: run.modelRoot,
        result: run.result,
        fileCount: run.fileCount,
        parseErrors: run.parseErrors,
        worstLimit: options.worst,
      }));
    }
  }

  if (options.json) {
    const payload = {
      generatedFrom: 'blueprint quality-gate',
      specVersion: spec.version ?? null,
      runs: runs.map((run) => ({
        modelRoot: run.modelRoot,
        fileCount: run.fileCount,
        schemaVersion: run.result.schemaVersion,
        patchMode: run.result.patchMode,
        parseErrors: run.parseErrors,
        metrics: run.result.metrics,
        findings: run.result.findings.map((finding) => ({
          ...finding,
          file: path.relative(run.modelRoot, finding.file),
        })),
        worstFiles: run.result.worstFiles.map((entry) => ({
          ...entry,
          file: path.relative(run.modelRoot, entry.file),
        })),
        breaches: run.result.breaches.map((metric) => metric.id),
        ok: run.result.ok,
      })),
    };
    const serialized = JSON.stringify(payload, null, 2);
    if (options.jsonFile) {
      fs.writeFileSync(options.jsonFile, serialized);
      if (!options.quiet) console.log(`  JSON written: ${options.jsonFile}`);
    } else {
      console.log(serialized);
    }
  }

  const hasConfigError = runs.some((run) => run.result.configErrors.length > 0);
  const hasBreach = runs.some((run) => !run.result.ok);
  if (hasConfigError) process.exit(2);
  process.exit(options.strict && hasBreach ? 1 : 0);
}

main();
