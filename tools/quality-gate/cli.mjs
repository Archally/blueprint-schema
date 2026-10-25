#!/usr/bin/env node
// @ts-check
/**
 * Blueprint quality gate — the deterministic feedback loop for the dimensions the
 * validator and the semantic checker do not measure.
 *
 * Zero-build, one runtime dependency (`yaml`), path-argument-driven: the same files
 * run wherever the tool directory is placed.
 *
 * Usage:
 *   node cli.mjs <modelRoot> [<modelRoot> ...] [options]
 *
 * Options:
 *   --strict              exit 1 on any threshold or baseline breach
 *   --since <git-ref>     patch mode: score only entities in files changed since ref
 *   --slice <name>        slice mode: score only one slice (first path segment),
 *                         against the whole-model bar and its per-slice baseline
 *   --entity <id>         entity mode: report one entity, field by field. The id is the
 *                         entity's own (`catalog.CN001`, `MDL800`) or a part it owns (`CAT813`)
 *   --file <path>         file mode: report every entity of one file, field by field. The path
 *                         is relative to the model root, or to the working directory
 *   --json [file]         machine-readable output (stdout when no file given)
 *   --spec <file>         alternative quality spec
 *   --schemas <dir>       schema tree the structure signals read types from: a version root
 *                         (`.../v2.8`) or a directory of versions. Default: found by walking up
 *                         from the model, then from this tool's directory
 *   --config <file>       alternative project config (default: .blueprint-quality.yaml)
 *   --update-baseline     write the current scores back as the ratchet baseline
 *   --worst <n>           worst-file and worst-entity rows to print (default 15)
 *   --quiet               suppress the text report
 *
 * Exit codes: 0 = clean, 1 = breach in --strict, 2 = usage error, unreadable config, or a
 *              model file that did not parse (nothing in it was measured).
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectObservations } from './collect.mjs';
import { evaluate, nextBaseline } from './evaluate.mjs';
import { renderReport } from './report.mjs';
import { changedFilesSince } from './git-changes.mjs';
import { loadSpec, loadProjectConfig, writeBaseline, PROJECT_CONFIG_NAME } from './config.mjs';
import { normalizeSliceArg, observedSlices } from './slice.mjs';
import { selectEntity, selectFile } from './entities.mjs';
import { locateSchemaRoot, loadSchemaIndex, measureStructure } from './structure.mjs';

const TOOL_DIR = path.dirname(new URL(import.meta.url).pathname);

const USAGE = 'usage: node cli.mjs <modelRoot> [more roots] [--strict] [--since <ref> | --slice <name> | --entity <id> | --file <path>] [--json [file]] [--spec <file>] [--schemas <dir>] [--config <file>] [--update-baseline] [--worst <n>] [--quiet]';

/** The scoping modes; a run takes at most one. */
const SCOPING_FLAGS = ['since', 'slice', 'entity', 'file'];

/** @param {string[]} argv */
export function parseArguments(argv) {
  /** @type {{roots: string[], strict: boolean, since?: string, slice?: string, entity?: string, file?: string, json: boolean, jsonFile?: string, spec?: string, schemas?: string, config?: string, updateBaseline: boolean, worst: number, quiet: boolean}} */
  const options = { roots: [], strict: false, json: false, updateBaseline: false, worst: 15, quiet: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case '--strict': options.strict = true; break;
      case '--update-baseline': options.updateBaseline = true; break;
      case '--quiet': options.quiet = true; break;
      case '--since': options.since = argv[++index]; break;
      case '--slice': options.slice = normalizeSliceArg(argv[++index]); break;
      case '--entity': options.entity = requireValue(argument, argv[++index]); break;
      case '--file': options.file = requireValue(argument, argv[++index]); break;
      case '--spec': options.spec = argv[++index]; break;
      case '--schemas': options.schemas = requireValue(argument, argv[++index]); break;
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
  const scoping = SCOPING_FLAGS.filter((name) => options[name] !== undefined);
  if (scoping.length > 1) {
    const quantifier = scoping.length === 2 ? 'both' : 'all';
    throw new Error(`--${scoping.join(' and --')} are ${quantifier} scoping modes and cannot be combined`);
  }
  if ((options.entity || options.file) && options.updateBaseline) {
    throw new Error('--update-baseline measures the whole model or one slice and cannot be combined with --entity or --file');
  }
  if ((options.entity || options.file) && options.roots.length > 1) {
    throw new Error('--entity and --file select inside one model; pass exactly one model root');
  }
  return options;
}

/** @param {string} flag @param {string|undefined} value */
function requireValue(flag, value) {
  if (value === undefined || value.startsWith('--') || value.trim() === '') throw new Error(`${flag} needs a value\n${USAGE}`);
  return value;
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

  const { observations, parseErrors, fileCount, schemaVersion, documents } = collectObservations(resolvedRoot);
  // A slice that selects nothing scores nothing, and a gate that passes over nothing is
  // worse than one that fails: it reports a green verdict the caller will believe. A
  // misspelled slice and an empty one are the same mistake from here, so both refuse.
  if (options.slice) {
    const available = observedSlices(observations);
    if (!available.includes(options.slice)) {
      throw new Error(
        `--slice ${options.slice} selects nothing measurable. Available slices: ${available.join(', ')}`,
      );
    }
  }

  const { config, path: configPath } = loadProjectConfig(resolvedRoot, options.config);
  const changedFiles = options.since ? changedFilesSince(resolvedRoot, options.since) : undefined;

  // Entity and file mode refuse an empty selection for the same reason slice mode does.
  const selection = options.entity
    ? { mode: /** @type {const} */ ('entity'), value: options.entity, ...selectEntity(observations, options.entity) }
    : options.file
      ? { mode: /** @type {const} */ ('file'), value: options.file, ...selectFile(observations, resolvedRoot, options.file) }
      : undefined;

  // The structure signals read the schema's own types; without one they still report references
  // held only in prose, and the available set reads as unknown.
  const schema = locateSchemaRoot({ explicit: options.schemas, schemaVersion, modelRoot: resolvedRoot, toolDir: TOOL_DIR });
  const schemaIndex = schema.root ? loadSchemaIndex(schema.root) : null;
  const structure = measureStructure({ documents, schemaIndex, structureSpec: spec.structure });

  const result = evaluate({ observations, spec, config, changedFiles, slice: options.slice, selection, schemaVersion, structure });
  result.structure = { schemaRoot: schema.root, schemaSource: schema.source ?? null, note: schema.note ?? null, ...result.structure };

  if (options.updateBaseline) {
    const target = configPath ?? path.join(resolvedRoot, PROJECT_CONFIG_NAME);
    // A slice update ratchets that slice's own floor; a whole-model update the flat
    // one. The flat map's reserved `slices` key is not a metric, so keep it out of
    // the ratchet math — writeBaseline preserves it separately.
    const existing = options.slice
      ? (config.baseline?.slices ?? {})[options.slice] ?? {}
      : (({ slices, ...flat }) => flat)(config.baseline ?? {});
    writeBaseline(target, nextBaseline(result, existing), options.slice);
    if (!options.quiet) {
      console.log(`  baseline written: ${target}${options.slice ? ` (slice: ${options.slice})` : ''}`);
    }
  }

  return { modelRoot: resolvedRoot, result, fileCount, parseErrors, configPath };
}

/**
 * One entity's structure signals, as `--json` carries them.
 * @param {import('./structure.mjs').StructureRecord} record
 */
function structureJson(record) {
  return {
    kind: record.kind,
    type: record.type,
    fieldsUsed: record.fieldsUsed,
    fieldsAvailable: record.fieldsAvailable,
    descriptionLength: record.descriptionLength,
    proseOnlyReferences: record.proseOnlyReferences,
  };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message));
    process.exitCode = 2;
    return;
  }

  let spec;
  try {
    ({ spec } = loadSpec(options.spec));
  } catch (error) {
    console.error(String(error.message));
    process.exitCode = 2;
    return;
  }

  const runs = [];
  for (const modelRoot of options.roots) {
    try {
      runs.push(runOne(modelRoot, options, spec));
    } catch (error) {
      console.error(`error scanning ${modelRoot}: ${String(error.message)}`);
      process.exitCode = 2;
      return;
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
        sliceMode: run.result.sliceMode,
        entityMode: run.result.entityMode,
        fileMode: run.result.fileMode,
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
        entities: run.result.entities.map((entity) => ({
          entityId: entity.entityId ?? null,
          name: entity.name,
          kind: entity.kind,
          file: path.relative(run.modelRoot, entity.file),
          ...(entity.ownedIds.length > 0 ? { ownedIds: entity.ownedIds } : {}),
          counts: entity.counts,
          findings: entity.fields.filter((row) => row.status !== 'covered'),
          ...(entity.structure ? { structure: structureJson(entity.structure) } : {}),
        })),
        structure: {
          schemaRoot: run.result.structure.schemaRoot,
          schemaSource: run.result.structure.schemaSource,
          note: run.result.structure.note,
          kinds: run.result.structure.kinds,
        },
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
  // A file that did not parse was not measured, and every metric it fed reads `no-data`, which
  // prints like a pass. The verdict has to reflect that, and NOT only under `--strict`: measured on
  // a model whose six `models.yaml` files were broken, the breach count fell from three to one,
  // because a breach leaves with the file that carried it. A gate that reports a better score on a
  // broken model is worse than no gate. `bp validate` is the verb that explains such a file; this
  // one refuses to pronounce on a model it could not read.
  const hasParseError = runs.some((run) => run.parseErrors.length > 0);
  // Set the code and let the process end on its own: `process.exit` would end it before a large
  // report written to a pipe has drained, and the reader would get the first 64 KiB of it.
  process.exitCode = hasConfigError || hasParseError ? 2 : options.strict && hasBreach ? 1 : 0;
}

main();
