// @ts-check
/**
 * Observations + spec + project config → scored result.
 *
 * Three independent gating mechanisms, because one size does not fit a corpus that
 * ranges from a 3-file sketch to a 557-file brownfield model (plan D19):
 *
 *   threshold — absolute bar. Meaningful for greenfield and for patch mode.
 *   baseline  — ratchet: "never worse than today". The only mechanism that gives a
 *               19%-coverage model something it can actually pass, which is the
 *               difference between a gate that runs and a gate that gets deferred off.
 *   deferral  — explicit, reasoned, EXPIRING suppression.
 */

import { classifyValue } from './heuristics.mjs';

/**
 * A metric applies to a model when the model's schema version is in its `applies_to`
 * list. Versions are compared on `major.minor` so a 2.7.7 model matches "2.7" —
 * quality metrics track the minor line, not the patch.
 * @param {string[]|undefined} appliesTo
 * @param {string|undefined} schemaVersion
 */
function versionApplies(appliesTo, schemaVersion) {
  if (!appliesTo || appliesTo.length === 0) return true;
  if (!schemaVersion) return true; // unknown version: measure, don't silently skip
  const [major, minor] = String(schemaVersion).split('.');
  const modelLine = `${major}.${minor}`;
  return appliesTo.some((declared) => String(declared) === modelLine || String(declared) === schemaVersion);
}

/**
 * @param {object} deferral
 * @param {string} metricId
 * @param {Date} now
 * @returns {{valid: boolean, error?: string, expired?: boolean}}
 */
function checkDeferral(deferral, metricId, now) {
  if (!deferral.reason || String(deferral.reason).trim().length === 0) {
    return { valid: false, error: `deferral for "${metricId}" has no reason — a deferral without a stated reason is just a disabled check` };
  }
  if (!deferral.expires) {
    return { valid: false, error: `deferral for "${metricId}" has no "expires" date — deferrals must expire or they become permanent` };
  }
  const expiryDate = new Date(String(deferral.expires));
  if (Number.isNaN(expiryDate.getTime())) {
    return { valid: false, error: `deferral for "${metricId}" has an unparseable "expires" value: ${deferral.expires}` };
  }
  return { valid: true, expired: expiryDate < now };
}

/**
 * @param {object} input
 * @param {import('./collect.mjs').Observation[]} input.observations
 * @param {object} input.spec
 * @param {object} [input.config]           project `.blueprint-quality.yaml`
 * @param {Set<string>} [input.changedFiles] absolute paths; when present, patch mode
 * @param {string} [input.slice]            slice name; when present, slice mode
 * @param {string} [input.schemaVersion]
 * @param {Date} [input.now]
 */
export function evaluate({ observations, spec, config = {}, changedFiles, slice, schemaVersion, now = new Date() }) {
  const thresholdOverrides = config.thresholds ?? {};
  // Per-slice baselines live under `baseline.slices.<name>`; a slice run ratchets
  // against its own floor, a whole-model run against the flat `baseline` map. The two
  // never mix — a slice's baseline is a claim about that slice, nothing else.
  const flatBaselines = config.baseline ?? {};
  const sliceBaselines = (config.baseline?.slices ?? {})[slice ?? ''] ?? {};
  const baselines = slice ? sliceBaselines : flatBaselines;

  // Deferrals: global `deferrals` apply in every scope; `slice_deferrals.<name>` apply
  // ONLY in that slice's run, so an un-enriched slice can carry its own expiring
  // suppression without hiding the same gap in a slice that IS done. A slice-scoped
  // deferral takes precedence over a global one for the same metric in a slice run.
  const globalDeferrals = config.deferrals ?? [];
  const sliceDeferrals = slice ? (config.slice_deferrals ?? {})[slice] ?? [] : [];
  const deferralsByMetric = new Map(
    [...globalDeferrals, ...sliceDeferrals].map((deferral) => [deferral.metric, deferral]),
  );

  /** @type {string[]} */
  const configErrors = [];
  /** @type {string[]} */
  const warnings = [];
  const scopedObservations = changedFiles
    ? observations.filter((observation) => changedFiles.has(observation.file))
    : slice
      ? observations.filter((observation) => observation.slice === slice)
      : observations;

  const observationsByMetric = new Map();
  for (const observation of scopedObservations) {
    const bucket = observationsByMetric.get(observation.metric) ?? [];
    bucket.push(observation);
    observationsByMetric.set(observation.metric, bucket);
  }

  const metrics = [];
  /** @type {Array<object>} */
  const findings = [];
  /** @type {Map<string, {file: string, missing: number, filler: number}>} */
  const byFile = new Map();

  for (const [metricId, metricSpec] of Object.entries(spec.metrics ?? {})) {
    const enabled = metricSpec.enabled !== false;
    const applies = versionApplies(metricSpec.applies_to, schemaVersion);
    const bucket = observationsByMetric.get(metricId) ?? [];

    let covered = 0;
    let filler = 0;
    let missing = 0;

    for (const observation of bucket) {
      const { status, reason } = classifyValue(observation.value, metricSpec.content, observation.context);
      if (status === 'covered') {
        covered++;
        continue;
      }
      if (status === 'filler') filler++;
      else missing++;

      findings.push({
        metric: metricId,
        status,
        reason,
        file: observation.file,
        entityId: observation.entityId,
        subject: observation.subject,
      });
      const fileEntry = byFile.get(observation.file) ?? { file: observation.file, missing: 0, filler: 0 };
      if (status === 'filler') fileEntry.filler++;
      else fileEntry.missing++;
      byFile.set(observation.file, fileEntry);
    }

    const total = bucket.length;
    const score = total > 0 ? covered / total : null;
    // Patch mode judges work being authored right now, so it uses the higher bar.
    // A model can be at 19% overall and still be required to write the NEXT property
    // properly — that gap is the whole reason a brownfield gate is usable at all.
    const specThreshold = changedFiles
      ? (metricSpec.patch_threshold ?? metricSpec.threshold ?? null)
      : (metricSpec.threshold ?? null);
    const threshold = thresholdOverrides[metricId] ?? specThreshold;
    // `baselines` may be the flat map, whose reserved `slices` key is not a metric.
    const baseline = metricId === 'slices' ? null : (baselines[metricId] ?? null);
    const deferral = deferralsByMetric.get(metricId);

    let status;
    if (!enabled) status = 'off';
    else if (!applies) status = 'not-applicable';
    else if (total === 0) status = 'no-data';
    else if (deferral) {
      const check = checkDeferral(deferral, metricId, now);
      if (!check.valid) {
        configErrors.push(/** @type {string} */(check.error));
        status = 'invalid-deferral';
      } else {
        if (check.expired) {
          warnings.push(`deferral for "${metricId}" expired on ${deferral.expires} — it is still suppressing the gate`);
        }
        status = 'deferred';
      }
    } else if (!changedFiles && baseline !== null && score !== null && score < baseline - 1e-9) {
      // The ratchet is a whole-model claim ("this model never gets worse"); comparing
      // a changed-file subset (patch mode) against it would fire on any edit to a weak
      // area, so patch mode is exempt. Slice mode is NOT — a slice's baseline is a
      // claim about the whole slice, measured against the whole slice, so it ratchets
      // exactly as the whole-model run does.
      status = 'below-baseline';
    } else if (threshold !== null && score !== null && score < threshold - 1e-9) {
      status = 'below-threshold';
    } else {
      status = 'pass';
    }

    metrics.push({
      id: metricId,
      title: metricSpec.title ?? metricId,
      layer: metricSpec.layer ?? 'other',
      total, covered, filler, missing, score,
      threshold, baseline, status,
      calibration: metricSpec.calibration,
      deferral: deferral ? { reason: deferral.reason, expires: deferral.expires } : undefined,
    });
  }

  const breaches = metrics.filter(
    (metric) => metric.status === 'below-threshold' || metric.status === 'below-baseline' || metric.status === 'invalid-deferral',
  );

  const worstFiles = [...byFile.values()]
    .map((entry) => ({ ...entry, score: entry.missing + entry.filler }))
    .sort((a, b) => b.score - a.score);

  const scopedFileCount = changedFiles
    ? changedFiles.size
    : slice
      ? new Set(scopedObservations.map((observation) => observation.file)).size
      : undefined;

  return {
    schemaVersion,
    patchMode: Boolean(changedFiles),
    sliceMode: slice ? slice : undefined,
    scopedFileCount,
    metrics,
    findings,
    worstFiles,
    breaches,
    configErrors,
    warnings,
    ok: breaches.length === 0,
  };
}

/**
 * Compute the baseline block a `--update-baseline` run should write: every gated
 * metric's current score, never lowering an existing entry (a ratchet only turns
 * one way — otherwise a bad run would quietly license the regression it caused).
 * @param {ReturnType<typeof evaluate>} result
 * @param {Record<string, number>} [existing]
 */
export function nextBaseline(result, existing = {}) {
  const updated = { ...existing };
  for (const metric of result.metrics) {
    if (metric.score === null || metric.status === 'off' || metric.status === 'not-applicable') continue;
    const rounded = Math.floor(metric.score * 1000) / 1000;
    updated[metric.id] = Math.max(updated[metric.id] ?? 0, rounded);
  }
  return updated;
}
