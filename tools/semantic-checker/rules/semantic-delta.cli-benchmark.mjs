// @ts-check
/** Source-backed declarative CLI probe. No build, index writes, or client fixtures. */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { buildBlueprintModel, groupDocumentsBySchemaType, getSchemaForFile } from '@blueprint-viewer/core';
import { buildModelState } from '@archally/blueprint-migrations';
import { buildSemanticCandidate } from '@archally/blueprint-migrations/node';
import { withCapturedModelStateSources } from '@archally/blueprint-migrations/offline-states';
import { runChecker } from '@archally/semantic-checker';
import { readLintConfig, readLintConfigFile, toCheckableModel } from '@archally/cli-shared';
import { loadSemanticEnvironment } from './semantic-delta.mjs';

const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), '../../../..');
const host = { readLintConfig, readLintConfigFile, toCheckableModel };
/** @param {string} directory @returns {string[]} */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
/** @param {string} directory */
function digest(directory) {
  return createHash('sha256').update(JSON.stringify(files(directory).map(path => [path, readFileSync(path, 'hex')]))).digest('hex');
}
/** Mirrors CLI recursive source loading and canonical grouping; generated JSON is valid YAML. @param {string} directory */
function load(directory) {
  return buildBlueprintModel(groupDocumentsBySchemaType(files(directory).flatMap(path => {
    const filePath = path.slice(directory.length + 1);
    const schemaType = getSchemaForFile(filePath);
    if (!schemaType) return [];
    const scope = filePath.includes('/') ? filePath.split('/')[0] : undefined;
    return [{ data: parse(readFileSync(path, 'utf8')), filePath, schemaType, scope }];
  })));
}
/** @param {string} specDir @param {string} migrationId */
async function envelope(specDir, migrationId) {
  const started = performance.now();
  const environment = await loadSemanticEnvironment(specDir, host);
  const environmentLoadedAt = performance.now();
  return withCapturedModelStateSources(specDir, async capture => {
    const capturedAt = performance.now();
    const baseline = load(capture.modelDirectory);
    const loadedAt = performance.now();
    let builds = 0;
    const candidate = await buildSemanticCandidate('synthetic', capture.modelDirectory, baseline,
      { mode: 'point-in-time', migrationId, statuses: null }, async (...arguments_) => {
        builds++;
        return buildModelState(...arguments_);
      });
    const replayedAt = performance.now();
    let checks = 0;
    runChecker(toCheckableModel(baseline), environment.rules, environment.config.config, environment.extensions);
    checks++;
    const baselineCheckedAt = performance.now();
    runChecker(toCheckableModel(candidate.model), environment.rules, environment.config.config, environment.extensions);
    checks++;
    const finishedAt = performance.now();
    if (builds !== 1 || checks !== 2) throw new Error('Unexpected envelope invocation counts');
    return { total_ms: finishedAt - started, environment_load_ms: environmentLoadedAt - started,
      capture_ms: capturedAt - environmentLoadedAt, capture_environment_ms: capturedAt - started,
      load_ms: loadedAt - capturedAt, replay_ms: replayedAt - loadedAt,
      baseline_check_ms: baselineCheckedAt - replayedAt, candidate_check_ms: finishedAt - baselineCheckedAt,
      copied_bytes: capture.records.reduce((total, record) => total + record.bytes.length, 0),
      entities: baseline.entities.length, relations: baseline.relations.length, candidate_builds: builds, checker_calls: checks };
  });
}
/** @param {string[]} arguments_ @param {NodeJS.ProcessEnv} [environment] @param {boolean} [timed] */
function child(arguments_, environment = process.env, timed = false) {
  const started = performance.now();
  const rssWrapper = 'process.on("exit", () => process.stderr.write("MSD_PEAK_RSS_BYTES=" + (process.resourceUsage().maxRSS * 1024) + "\\n"));';
  const result = spawnSync(process.execPath,
    timed ? ['--import', `data:text/javascript,${encodeURIComponent(rssWrapper)}`, ...arguments_] : arguments_,
    { cwd: repository, env: environment, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Child failed (${result.status}): ${result.stderr || result.error}`);
  return { wall_ms: performance.now() - started, report: JSON.parse(result.stdout), stderr: result.stderr };
}
/** @param {number[]} values */
function summary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return { median: sorted[1], range: [sorted[0], sorted[2]] };
}

if (process.argv[2] === '--envelope') {
  console.log(JSON.stringify(await envelope(process.argv[3], process.argv[4])));
} else {
  const scratch = process.argv[2];
  if (!scratch) throw new Error('Usage: node semantic-delta.cli-benchmark.mjs <scratch-directory>');
  mkdirSync(resolve(scratch), { recursive: true });
  const runDirectory = mkdtempSync(join(resolve(scratch), 'cli-run-'));
  const projectsDirectory = join(runDirectory, 'projects');
  const loadBefore = spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
  const outcomes = [];
  for (const [entityCount, relationCount] of [[1750, 3900], [3500, 7800]]) {
    const project = `synthetic${entityCount}`;
    const specDir = join(projectsDirectory, project, '.blueprint/v2.8');
    mkdirSync(join(specDir, 'synthetic'), { recursive: true });
    mkdirSync(join(specDir, '.migrations'));
    writeFileSync(join(specDir, 'blueprint.yaml'), JSON.stringify({ name: 'Synthetic performance fixture', version: '1.0.0', schemaVersion: '2.8.0' }));
    const concepts = Array.from({ length: entityCount }, (_, index) => ({
      id: `synthetic.CN${String(index + 1).padStart(4, '0')}`, name: `Concept ${index + 1}`,
      definition: 'Non-client synthetic performance fixture.',
      relationships: Array.from({ length: Math.floor(relationCount / entityCount) + (index < relationCount % entityCount ? 1 : 0) }, (_, offset) => ({
        object: `synthetic.CN${String((index + offset + 1) % entityCount + 1).padStart(4, '0')}`, predicate: 'uses', cardinality: '0..*',
      })),
    }));
    writeFileSync(join(specDir, 'synthetic/concepts.yaml'), JSON.stringify({ version: '1.0.0', concepts }));
    for (let index = 1; index <= 10; index++) {
      const identifier = `MIG${String(index).padStart(3, '0')}`;
      const dependsOn = index === 1 ? [] : [`MIG${String(index - 1).padStart(3, '0')}`];
      writeFileSync(join(specDir, '.migrations', `${identifier}.migration.yaml`), JSON.stringify({
        migration: { id: identifier, name: `Synthetic checkpoint ${index}`, status: 'pending', depends_on: dependsOn }, changes: {},
      }));
    }
    const sourceBytes = files(specDir).reduce((total, path) => total + readFileSync(path).length, 0);
    const sourceIdentity = digest(specDir);
    for (const closure of [1, 10]) {
      const migrationId = `MIG${String(closure).padStart(3, '0')}`;
      const repetitions = [];
      for (let repetition = 0; repetition < 4; repetition++) {
        const envelopeRun = child([script, '--envelope', specDir, migrationId]);
        if (envelopeRun.report.entities !== entityCount + 10 || envelopeRun.report.relations !== relationCount + 9) throw new Error(`Fixture count mismatch: ${JSON.stringify(envelopeRun.report)}`);
        const cli = child(['bin/bp.mjs', 'check', project, '--delta', '--mode', 'point-in-time', '--migration', migrationId, '--json'],
          { ...process.env, BLUEPRINT_PROJECTS_DIR: projectsDirectory }, true);
        const instrumentation = cli.report.semantic_delta.instrumentation;
        if (instrumentation.baseline_builds !== 1 || instrumentation.candidate_builds !== 1 || instrumentation.checker_calls !== 2 || instrumentation.closure_length !== closure) throw new Error('CLI invocation or closure count mismatch');
        if (instrumentation.copied_bytes !== sourceBytes) throw new Error('Copy/source byte mismatch');
        if (digest(specDir) !== sourceIdentity) throw new Error('Source fixture changed');
        const rssMatch = cli.stderr.match(/MSD_PEAK_RSS_BYTES=(\d+)/);
        if (!rssMatch) throw new Error(`Missing isolated RSS: ${cli.stderr}`);
        const bound = envelopeRun.report.total_ms * 1.25 + 100;
        const record = { repetition, wall_ms: cli.wall_ms, instrumentation, envelope: envelopeRun.report, bound_ms: bound,
          passes: instrumentation.total_ms <= bound, peak_rss_bytes: Number(rssMatch[1]) };
        writeFileSync(join(runDirectory, `${project}-${closure}-${repetition}.json`), JSON.stringify({ ...record, cli_report: cli.report }, null, 2));
        if (repetition > 0) repetitions.push(record);
      }
      outcomes.push({ entities: entityCount + 10, relations: relationCount + 9, concept_entities: entityCount, concept_relations: relationCount, closure, source_bytes: sourceBytes,
        wall_ms: summary(repetitions.map(result => result.wall_ms)), total_ms: summary(repetitions.map(result => result.instrumentation.total_ms)), repetitions });
    }
  }
  const result = { platform: `${platform()} ${release()} ${arch()}`, node: process.version, run_directory: runDirectory,
    mode: 'Warm filesystem after one warmup per case; fresh Node process for every CLI and separate envelope run; no persistent comparison cache.',
    rss_method: 'Node --import exit wrapper: process.resourceUsage().maxRSS * 1024 bytes; isolated CLI process including rendering/cleanup. darwin /usr/bin/time -l unavailable: sandbox denies sysctl kern.clockrate',
    envelope_method: 'Independent child: loadSemanticEnvironment(specDir, cli-shared host), withCapturedModelStateSources (same verified capture as CLI), CLI-equivalent recursive YAML load/canonical grouping, one candidate build and two canonical full checks. Times environment load, capture, source load, replay and each full check separately. Like CLI instrumented total, excludes post-callback source verification and cleanup; also excludes delta assembly, identity recheck and rendering. Bound compares CLI instrumented total, not startup/output wall time.',
    load_before: loadBefore, load_after: spawnSync('uptime', { encoding: 'utf8' }).stdout.trim(), outcomes };
  writeFileSync(join(runDirectory, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (outcomes.some(outcome => outcome.repetitions.some(repetition => !repetition.passes))) process.exitCode = 1;
}
