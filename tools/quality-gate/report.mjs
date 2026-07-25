// @ts-check
/**
 * Human-facing report rendering. Plain text, no colour dependency — this runs in
 * agent transcripts and CI logs as often as in a terminal.
 *
 * The report always separates MISSING from FILLER. They demand different fixes: a
 * missing description needs authoring, a filler one needs someone to notice the
 * author already "answered" the gate without saying anything.
 */

import path from 'node:path';

const STATUS_MARK = {
  pass: 'ok  ',
  'below-threshold': 'FAIL',
  'below-baseline': 'FAIL',
  'invalid-deferral': 'FAIL',
  deferred: 'defr',
  off: 'off ',
  'not-applicable': 'n/a ',
  'no-data': '--  ',
};

/** @param {number|null} value */
function percent(value) {
  return value === null ? '   —' : `${String(Math.round(value * 100)).padStart(3)}%`;
}

/** @param {number|null} value */
function bar(value) {
  if (value === null) return '          ';
  const filled = Math.round(value * 10);
  return '█'.repeat(filled) + '·'.repeat(10 - filled);
}

/**
 * @param {object} options
 * @param {string} options.modelRoot
 * @param {ReturnType<import('./evaluate.mjs').evaluate>} options.result
 * @param {number} options.fileCount
 * @param {string[]} options.parseErrors
 * @param {number} [options.worstLimit]
 * @returns {string}
 */
export function renderReport({ modelRoot, result, fileCount, parseErrors, worstLimit = 15 }) {
  const lines = [];
  const scope = result.patchMode
    ? `patch mode — ${result.scopedFileCount} changed file(s) of ${fileCount}`
    : `whole model — ${fileCount} file(s)`;

  lines.push('');
  lines.push(`Blueprint quality — ${modelRoot}`);
  lines.push(`  schema version: ${result.schemaVersion ?? 'unknown'}   scope: ${scope}`);
  lines.push('');

  const byLayer = new Map();
  for (const metric of result.metrics) {
    const bucket = byLayer.get(metric.layer) ?? [];
    bucket.push(metric);
    byLayer.set(metric.layer, bucket);
  }

  lines.push('      metric                                coverage      covered  filler  missing   bar');
  lines.push('      ' + '-'.repeat(88));
  for (const [layer, layerMetrics] of byLayer) {
    const gauged = layerMetrics.filter((metric) => metric.status !== 'not-applicable' && metric.status !== 'off');
    if (gauged.length === 0) continue;
    lines.push(`  ── ${layer}`);
    for (const metric of layerMetrics) {
      if (metric.status === 'not-applicable' || metric.status === 'off') continue;
      const target = metric.status === 'below-baseline'
        ? ` < baseline ${percent(metric.baseline).trim()}`
        : metric.threshold !== null
          ? ` / ${percent(metric.threshold).trim()}`
          : '';
      lines.push(
        `${STATUS_MARK[metric.status] ?? '?   '}  ${metric.id.padEnd(36)}  ${percent(metric.score)}${target.padEnd(14)}`
        + `${String(metric.covered).padStart(7)}${String(metric.filler).padStart(8)}${String(metric.missing).padStart(9)}   ${bar(metric.score)}`,
      );
      if (metric.status === 'deferred') {
        lines.push(`        deferred until ${metric.deferral?.expires}: ${metric.deferral?.reason}`);
      }
    }
  }

  const worst = result.worstFiles.slice(0, worstLimit);
  if (worst.length > 0) {
    lines.push('');
    lines.push(`  Worst files (missing + filler)`);
    for (const entry of worst) {
      lines.push(`    ${String(entry.score).padStart(5)}  ${path.relative(modelRoot, entry.file)}`
        + `  (missing ${entry.missing}, filler ${entry.filler})`);
    }
  }

  if (parseErrors.length > 0) {
    lines.push('');
    lines.push(`  Parse errors (${parseErrors.length}) — these files were not measured`);
    for (const parseError of parseErrors.slice(0, 10)) lines.push(`    ${parseError}`);
  }

  for (const warning of result.warnings) {
    lines.push('');
    lines.push(`  WARNING: ${warning}`);
  }
  for (const configError of result.configErrors) {
    lines.push('');
    lines.push(`  CONFIG ERROR: ${configError}`);
  }

  lines.push('');
  if (result.breaches.length === 0) {
    lines.push('  No threshold or baseline breaches.');
  } else {
    lines.push(`  ${result.breaches.length} breach(es): ${result.breaches.map((metric) => metric.id).join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}
