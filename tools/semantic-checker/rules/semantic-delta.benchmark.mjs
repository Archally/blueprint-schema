/** Synthetic, non-client cost probe. Run with Node after building blueprint-migrations. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { buildBlueprintModel } from '@blueprint-viewer/core';
import { buildModelState } from '@archally/blueprint-migrations';
import { buildSemanticCandidate } from '@archally/blueprint-migrations/node';
import { runChecker } from '@archally/semantic-checker';
import { readLintConfig, readLintConfigFile, toCheckableModel } from '@archally/cli-shared';
import { loadSemanticEnvironment, semanticComparison } from './semantic-delta.mjs';

const directory = mkdtempSync(join(tmpdir(), 'msd-benchmark-'));
try {
  mkdirSync(join(directory, '.migrations'));
  writeFileSync(join(directory, 'blueprint.yaml'), 'name: Synthetic\nversion: "1.0.0"\nschemaVersion: "2.8.0"\n');
  for (let index = 1; index <= 10; index++) {
    const identifier = `MIG${String(index).padStart(3, '0')}`;
    const prerequisite = index === 1 ? [] : [`MIG${String(index - 1).padStart(3, '0')}`];
    writeFileSync(join(directory, '.migrations', `${identifier}.migration.yaml`), `migration:\n  id: ${identifier}\n  depends_on: ${JSON.stringify(prerequisite)}\nchanges: {}\n`);
  }
  const environment = await loadSemanticEnvironment(directory, { readLintConfig, readLintConfigFile, toCheckableModel });
  const outcomes = [];
  for (const [entityCount, relationCount] of [[1750, 3900], [3500, 7800]]) {
    const model = buildBlueprintModel({});
    model.entities = Array.from({ length: entityCount }, (_, index) => ({ id: `synthetic.CN${index}`, displayId: `synthetic.CN${index}`, type: 'Concept', layer: 'design.concepts', data: { id: `synthetic.CN${index}`, name: `Concept ${index}` }, fileOrigin: 'synthetic/concepts.yaml' }));
    model.relations = Array.from({ length: relationCount }, (_, index) => ({ id: `relation-${index}`, source_entity_id: model.entities[index % entityCount].id, target_entity_id: model.entities[(index + 1) % entityCount].id, type: 'references' }));
    const source = JSON.stringify(model);
    for (const closure of [1, 10]) {
      const state = { mode: 'point-in-time', migrationId: `MIG${String(closure).padStart(3, '0')}`, statuses: null };
      const repetitions = [];
      for (let repetition = 0; repetition < 4; repetition++) {
        const envelopeStarted = performance.now();
        const baseline = JSON.parse(source);
        const candidate = await buildSemanticCandidate('synthetic', directory, baseline, state);
        runChecker(toCheckableModel(baseline), environment.rules, environment.config.config, environment.extensions);
        runChecker(toCheckableModel(candidate.model), environment.rules, environment.config.config, environment.extensions);
        const envelope = performance.now() - envelopeStarted;
        const started = performance.now();
        const comparisonBaseline = JSON.parse(source);
        let builds = 0;
        const comparisonCandidate = await buildSemanticCandidate('synthetic', directory, comparisonBaseline, state, async (...arguments_) => { builds++; return buildModelState(...arguments_); });
        let checks = 0;
        const result = semanticComparison(comparisonBaseline, comparisonCandidate.model, environment, (...arguments_) => { checks++; return runChecker(...arguments_); });
        const elapsed = performance.now() - started;
        if (builds !== 1 || checks !== 2) throw new Error(`Unexpected invocation counts: ${builds} builds/${checks} checks`);
        if (repetition > 0) repetitions.push({ envelope_ms: envelope, delta_ms: elapsed, diff_ms: result.instrumentation.diff_ms, bound_ms: envelope * 1.25 + 100, passes: elapsed <= envelope * 1.25 + 100, peak_rss_bytes: process.resourceUsage().maxRSS * 1024 });
      }
      const times = repetitions.map(result => result.delta_ms).sort((left, right) => left - right);
      outcomes.push({ entities: entityCount, relations: relationCount, closure, source_bytes: Buffer.byteLength(source), candidate_builds: 1, checker_calls: 2, median_ms: times[1], range_ms: [times[0], times[2]], repetitions });
    }
  }
  console.log(JSON.stringify({ platform: `${platform()} ${release()} ${arch()}`, mode: 'warm in-process; JSON synthetic baseline load, disk declarative replay; one warmup then three repetitions per case', limitation: 'No CLI source-loader/copy overhead or production large-model timing; RSS is process high-water mark.', outcomes }, null, 2));
  if (outcomes.some(outcome => outcome.repetitions.some(repetition => !repetition.passes))) process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
