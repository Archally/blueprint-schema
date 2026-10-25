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

/** One mark per field status in an entity block. */
const FIELD_MARK = { covered: 'ok  ', filler: 'FILL', missing: 'MISS' };

/** @param {number|null} value */
function percent(value) {
  return value === null ? '   -' : `${String(Math.round(value * 100)).padStart(3)}%`;
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
  const selectionMode = result.entityMode !== undefined || result.fileMode !== undefined;
  const scope = result.patchMode
    ? `patch mode - ${result.scopedFileCount} changed file(s) of ${fileCount}`
    : result.sliceMode
      ? `slice "${result.sliceMode}" - ${result.scopedFileCount} file(s) of ${fileCount}`
      : result.entityMode !== undefined
        ? `entity "${result.entityMode}" - ${result.entities.length} entity block(s), ${result.scopedFileCount} file(s) of ${fileCount}`
        : result.fileMode !== undefined
          ? `file "${result.fileMode}" - ${result.entities.length} entities`
          : `whole model - ${fileCount} file(s)`;

  lines.push('');
  lines.push(`Blueprint quality - ${modelRoot}`);
  lines.push(`  schema version: ${result.schemaVersion ?? 'unknown'}   scope: ${scope}`);
  // A file that did not parse was not measured, and a metric with nothing left to measure reads
  // `no-data`, which prints like a pass. Worse, a breach DISAPPEARS with the file that carried it:
  // measured on this model, breaking its six `models.yaml` files took the breach count from three
  // to one. So the count of unmeasured files leads the report rather than trailing it, and the
  // detail stays where it was.
  if (parseErrors.length > 0) {
    lines.push('');
    lines.push(
      `  ${parseErrors.length} file(s) DID NOT PARSE and were not measured. Every number below is`
      + ` over the ${fileCount - parseErrors.length} file(s) that did. Run \`bp validate\` first.`,
    );
  }
  lines.push('');

  // Entity and file mode lead with the entities, field by field: that is the question they ask.
  // The metric table follows, scored against the patch bar, with only the metrics that saw data.
  if (selectionMode) {
    for (const entity of result.entities) {
      lines.push(...renderEntityBlock(entity, modelRoot, result.focus, result.structure?.note));
      lines.push('');
    }
  }

  const byLayer = new Map();
  for (const metric of result.metrics) {
    const bucket = byLayer.get(metric.layer) ?? [];
    bucket.push(metric);
    byLayer.set(metric.layer, bucket);
  }

  lines.push('      metric                                coverage      covered  filler  missing   bar');
  lines.push('      ' + '-'.repeat(88));
  for (const [layer, layerMetrics] of byLayer) {
    const shown = (/** @type {any} */ metric) => metric.status !== 'not-applicable' && metric.status !== 'off'
      && !(selectionMode && metric.total === 0);
    const gauged = layerMetrics.filter(shown);
    if (gauged.length === 0) continue;
    lines.push(`  ── ${layer}`);
    for (const metric of layerMetrics) {
      if (!shown(metric)) continue;
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

  // In entity and file mode the entity blocks above already are the worklist.
  const worst = selectionMode ? [] : result.worstFiles.slice(0, worstLimit);
  if (worst.length > 0) {
    lines.push('');
    lines.push(`  Worst files (missing + filler)`);
    for (const entry of worst) {
      lines.push(`    ${String(entry.score).padStart(5)}  ${path.relative(modelRoot, entry.file)}`
        + `  (missing ${entry.missing}, filler ${entry.filler})`);
    }
  }

  const worstEntities = selectionMode ? [] : result.worstEntities.slice(0, worstLimit);
  if (worstEntities.length > 0) {
    lines.push('');
    lines.push(`  Worst entities (missing + filler fields)`);
    for (const entity of worstEntities) {
      lines.push(`    ${String(entity.score).padStart(5)}  ${entityHeading(entity)}  (${entity.kind}, ${path.relative(modelRoot, entity.file)})`
        + `  (missing ${entity.counts.missing}, filler ${entity.counts.filler})`);
    }
  }

  if (!selectionMode && result.structure && result.structure.kinds.length > 0) {
    lines.push('');
    lines.push(...renderStructure(result.structure, modelRoot, worstLimit));
  }

  if (parseErrors.length > 0) {
    lines.push('');
    lines.push(`  Parse errors (${parseErrors.length}) - these files were not measured`);
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

/** @param {import('./entities.mjs').EntityRecord} entity */
function entityHeading(entity) {
  return entity.entityId ? `${entity.entityId} ${entity.name}` : entity.name;
}

/**
 * One entity, one row per authored field. A part the entity owns with an id of its own (a
 * concept attribute's `CAT` id) is named on its row; the part `--entity` asked for is marked `>`.
 * @param {import('./entities.mjs').EntityRecord} entity
 * @param {string} modelRoot
 * @param {string} [focus]
 * @param {string|null} [schemaNote] why no schema was read, when none was
 */
function renderEntityBlock(entity, modelRoot, focus, schemaNote) {
  const { counts } = entity;
  const lines = [
    `  ${entityHeading(entity)}`,
    `    ${entity.kind} - ${path.relative(modelRoot, entity.file)} - ${counts.fields} field(s):`
      + ` ${counts.covered} covered, ${counts.filler} filler, ${counts.missing} missing`,
  ];
  const fieldWidth = Math.max(...entity.fields.map((row) => row.field.length));
  for (const row of entity.fields) {
    const pointer = focus !== undefined && row.ownedId === focus ? '>' : ' ';
    const owned = row.ownedId ? ` [${row.ownedId}]` : '';
    const reason = row.reason ? `  - ${row.reason}` : '';
    lines.push(`   ${pointer}${FIELD_MARK[row.status]}  ${row.field.padEnd(fieldWidth)}  ${row.subject}${owned}${reason}`);
  }
  if (entity.structure) lines.push(...renderEntityStructure(entity.structure, schemaNote));
  return lines;
}

/**
 * The structure lines of one entity block: fields used against those available, the description's
 * length, and each reference held only in prose with what the schema offers for it.
 * @param {import('./structure.mjs').StructureRecord} record
 * @param {string|null} [schemaNote]
 */
function renderEntityStructure(record, schemaNote) {
  const used = record.fieldsUsed.length > 0 ? ` (${record.fieldsUsed.join(', ')})` : '';
  const available = record.fieldsAvailable === null
    ? `${record.fieldsUsed.length}${used}, available set unknown${schemaNote ? ` - ${schemaNote}` : ''}`
    : `${record.fieldsUsed.length} of ${record.fieldsAvailable}${used}`;
  const lines = [`    fields used: ${available}; description ${record.descriptionLength} chars`];
  const width = Math.max(0, ...record.proseOnlyReferences.map((reference) => reference.id.length));
  for (const reference of record.proseOnlyReferences) {
    const verdict = reference.schemaHasField === null
      ? 'no schema read, so whether a field can hold it is unknown'
      : reference.schemaHasField
        ? `a field can hold it: ${reference.fields.join(', ')}`
        : 'the schema has no field for this';
    const written = reference.written !== reference.id ? ` (written ${reference.written})` : '';
    lines.push(`    held only in prose  ${reference.id.padEnd(width)}  ${verdict}${written}`);
  }
  return lines;
}

/**
 * The whole-model structure section: one row per measured kind, then the entities that hold
 * references only in prose, most references first.
 * @param {ReturnType<import('./evaluate.mjs').evaluate>['structure'] & {schemaRoot?: string|null, note?: string|null}} structure
 * @param {string} modelRoot
 * @param {number} limit
 */
function renderStructure(structure, modelRoot, limit) {
  const lines = ['  Structure - facts in fields or only in prose (read beside the metrics; no threshold, no exit code)'];
  lines.push(structure.schemaRoot
    ? `  types read from: ${structure.schemaRoot}`
    : `  no schema read: ${structure.note ?? 'none found'} - available sets are unknown`);
  const labels = structure.kinds.map((kind) => (kind.type ? `${kind.kind} (${kind.type})` : kind.kind));
  const labelWidth = Math.max(16, ...labels.map((label) => label.length));
  lines.push(`      ${'kind (type)'.padEnd(labelWidth)}  entities  with prose-only refs   refs  schema gap   fields used med/max of available   description med/max`);
  structure.kinds.forEach((kind, index) => {
    const available = kind.fieldsAvailable === null ? '?' : String(kind.fieldsAvailable);
    lines.push(
      `      ${labels[index].padEnd(labelWidth)}  ${String(kind.entities).padStart(8)}  ${String(kind.withProseOnlyReferences).padStart(19)}`
      + `  ${String(kind.proseOnlyReferences).padStart(5)}  ${String(kind.schemaGapReferences).padStart(10)}`
      + `   ${`${kind.fieldsUsed.median}/${kind.fieldsUsed.max} of ${available}`.padStart(33)}`
      + `   ${`${kind.descriptionLength.median}/${kind.descriptionLength.max}`.padStart(19)}`,
    );
  });

  const holding = structure.records
    .filter((record) => record.proseOnlyReferences.length > 0)
    .sort((a, b) => b.proseOnlyReferences.length - a.proseOnlyReferences.length);
  if (holding.length > 0) {
    lines.push('');
    lines.push(`  Entities with references held only in prose (${holding.length})`);
    for (const record of holding.slice(0, limit)) {
      const heading = record.entityId ? `${record.entityId} ${record.name}` : record.name;
      lines.push(`    ${heading}  (${record.kind}, ${path.relative(modelRoot, record.file)}): ${record.proseOnlyReferences.map((reference) => reference.id).join(', ')}`);
    }
    if (holding.length > limit) lines.push(`    ... and ${holding.length - limit} more; --json lists every one`);
  }
  return lines;
}
