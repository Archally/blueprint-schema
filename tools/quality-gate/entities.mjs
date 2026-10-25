// @ts-check
/**
 * Entity scoping and the per-entity rollup.
 *
 * An entity is what an author edits: a concept with its attributes, a model with its
 * properties, an operation, a rule. Every observation names the entity it rolls up to
 * (`entityId`, `entityName`, `entityKind`), so the gate can answer for one entity or for the
 * entities of one file as well as per metric.
 *
 * Two metrics can read the same field: an event's description is read by the operation metric
 * and by the event metric, an enum property's description by the property metric and by the
 * enum-property metric. The metrics keep counting it once each, since each is its own lens; the
 * per-entity view counts it once, as one field, and names every metric that read it.
 */

import fs from 'node:fs';
import path from 'node:path';

/** How bad a status is, so a field read by two metrics reports the worse verdict. */
const STATUS_RANK = { covered: 0, filler: 1, missing: 2 };

/** Candidates listed when a selection names nothing. */
const CANDIDATE_LIMIT = 10;

const TYPED_PREFIX_RE = /^(?:[a-z0-9-]+\.)*([A-Z]{1,4})\d/;

/**
 * The key that identifies one entity: its typed id within its file, or its name within its file
 * when it has no typed id. The file is part of the key so a duplicated id reads as two entities,
 * each in its own file, rather than as one entity spread over two.
 * @param {{file: string, entityId?: string, entityName?: string}} observation
 */
export function entityKeyOf(observation) {
  return `${observation.file}\u0000${observation.entityId ?? `#${observation.entityName ?? ''}`}`;
}

/**
 * @typedef {object} EntityField
 * @property {string} field
 * @property {string} subject
 * @property {string} [ownedId]
 * @property {'covered'|'filler'|'missing'} status
 * @property {string} [reason]
 * @property {string[]} metrics
 */

/**
 * @typedef {object} EntityRecord
 * @property {string} key
 * @property {string} [entityId]
 * @property {string} name
 * @property {string} kind
 * @property {string} file      absolute path
 * @property {string[]} ownedIds
 * @property {EntityField[]} fields
 * @property {{fields: number, covered: number, filler: number, missing: number}} counts
 * @property {import('./structure.mjs').StructureRecord} [structure] the structure signals, when its kind is measured
 */

/**
 * Roll classified observations up to one record per entity, in the order entities were first
 * observed. One row per authored field; a field read by several metrics is one row.
 * @param {Array<{observation: import('./collect.mjs').Observation, metric: string, status: 'covered'|'filler'|'missing', reason?: string}>} classified
 * @returns {EntityRecord[]}
 */
export function rollupEntities(classified) {
  /** @type {Map<string, EntityRecord & {byField: Map<string, EntityField>}>} */
  const byKey = new Map();
  for (const { observation, metric, status, reason } of classified) {
    const key = entityKeyOf(observation);
    let entity = byKey.get(key);
    if (!entity) {
      entity = {
        key,
        entityId: observation.entityId,
        name: observation.entityName ?? observation.subject,
        kind: observation.entityKind ?? 'entity',
        file: observation.file,
        ownedIds: [],
        fields: [],
        counts: { fields: 0, covered: 0, filler: 0, missing: 0 },
        byField: new Map(),
      };
      byKey.set(key, entity);
    }
    const fieldKey = `${observation.subject}\u0000${observation.field}`;
    const existing = entity.byField.get(fieldKey);
    if (existing) {
      existing.metrics.push(metric);
      if (STATUS_RANK[status] > STATUS_RANK[existing.status]) {
        existing.status = status;
        existing.reason = reason;
      }
      continue;
    }
    /** @type {EntityField} */
    const row = { field: observation.field, subject: observation.subject, status, reason, metrics: [metric] };
    if (observation.ownedId) {
      row.ownedId = observation.ownedId;
      if (!entity.ownedIds.includes(observation.ownedId)) entity.ownedIds.push(observation.ownedId);
    }
    entity.byField.set(fieldKey, row);
    entity.fields.push(row);
  }

  return [...byKey.values()].map(({ byField, ...entity }) => {
    for (const row of entity.fields) {
      entity.counts.fields++;
      entity.counts[row.status]++;
    }
    return entity;
  });
}

/**
 * The entities with the most missing and filler fields, worst first; ties keep model order.
 * @param {EntityRecord[]} entities
 */
export function worstEntities(entities) {
  return entities
    .map((entity) => ({ entity, score: entity.counts.missing + entity.counts.filler }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entity, score }) => ({ ...entity, score }));
}

/** @param {string} id */
function typedPrefixOf(id) {
  return TYPED_PREFIX_RE.exec(id)?.[1];
}

/**
 * Every typed id the model's observations name, owners and owned parts alike.
 * @param {import('./collect.mjs').Observation[]} observations
 */
function knownIds(observations) {
  const ids = new Set();
  for (const observation of observations) {
    if (observation.entityId) ids.add(observation.entityId);
    if (observation.ownedId) ids.add(observation.ownedId);
  }
  return [...ids].sort();
}

/**
 * Select the entity `--entity <id>` names. The id may be the entity's own (`catalog.CN001`,
 * `MDL800`) or the id of a part it owns (`CAT813`, a concept attribute), which selects the
 * owning entity and marks the part as the focus. A bare id without its scope prefix
 * (`CN001` for `catalog.CN001`) is accepted when exactly one entity carries it.
 *
 * A selection that names nothing refuses, as `--slice` does: a gate that passes over nothing
 * reports a green verdict the caller will believe.
 * @param {import('./collect.mjs').Observation[]} observations
 * @param {string} requested
 * @returns {{selected: Set<import('./collect.mjs').Observation>, focus?: string}}
 */
export function selectEntity(observations, requested) {
  const id = String(requested).trim();
  const matchesExactly = (/** @type {string|undefined} */ candidate) => candidate === id;
  const matchesUnscoped = (/** @type {string|undefined} */ candidate) => Boolean(candidate?.endsWith(`.${id}`));

  let matchedIds = new Set();
  for (const matches of [matchesExactly, matchesUnscoped]) {
    for (const observation of observations) {
      if (matches(observation.entityId)) matchedIds.add(observation.entityId);
      if (matches(observation.ownedId)) matchedIds.add(observation.ownedId);
    }
    if (matchedIds.size > 0) break;
  }

  if (matchedIds.size > 1) {
    throw new Error(`--entity ${id} is ambiguous. It matches: ${[...matchedIds].sort().join(', ')}`);
  }
  if (matchedIds.size === 0) {
    const all = knownIds(observations);
    const prefix = typedPrefixOf(id);
    const samePrefix = prefix ? all.filter((candidate) => typedPrefixOf(candidate) === prefix) : [];
    if (samePrefix.length > 0) {
      const shown = samePrefix.slice(0, CANDIDATE_LIMIT).join(', ');
      const more = samePrefix.length > CANDIDATE_LIMIT ? ` (and ${samePrefix.length - CANDIDATE_LIMIT} more)` : '';
      throw new Error(`--entity ${id} selects nothing measurable. Ids with the prefix ${prefix}: ${shown}${more}`);
    }
    const prefixes = [...new Set(all.map(typedPrefixOf).filter(Boolean))].sort();
    throw new Error(
      `--entity ${id} selects nothing measurable. This model has ${all.length} typed ids;`
      + ` their prefixes: ${prefixes.join(', ')}`,
    );
  }

  const [matchedId] = matchedIds;
  const owningKeys = new Set(
    observations
      .filter((observation) => observation.entityId === matchedId || observation.ownedId === matchedId)
      .map(entityKeyOf),
  );
  const selected = new Set(observations.filter((observation) => owningKeys.has(entityKeyOf(observation))));
  const isOwnedPart = observations.some((observation) => observation.ownedId === matchedId);
  return { selected, focus: isOwnedPart ? matchedId : undefined };
}

/**
 * Select the entities of the file `--file <path>` names. The path is read relative to the model
 * root first, then relative to the working directory, so both `admin/models.yaml` and the path an
 * editor reports (`projects/<p>/.blueprint/v2.8/admin/models.yaml`) work.
 * @param {import('./collect.mjs').Observation[]} observations
 * @param {string} modelRoot absolute
 * @param {string} requested
 * @param {string} [workingDirectory]
 * @returns {{selected: Set<import('./collect.mjs').Observation>, file: string}}
 */
export function selectFile(observations, modelRoot, requested, workingDirectory = process.cwd()) {
  const raw = String(requested).trim();
  const observedFiles = new Set(observations.map((observation) => observation.file));
  const attempts = [path.resolve(modelRoot, raw), path.resolve(workingDirectory, raw)];
  const file = attempts.find((candidate) => observedFiles.has(candidate));
  if (file) {
    return { selected: new Set(observations.filter((observation) => observation.file === file)), file };
  }

  const existing = attempts.find((candidate) => fs.existsSync(candidate) && candidate.startsWith(modelRoot + path.sep));
  if (existing) {
    throw new Error(`--file ${raw} selects nothing measurable: the file holds no entity the gate observes`);
  }
  const relativeFiles = [...observedFiles].map((observed) => path.relative(modelRoot, observed)).sort();
  const base = path.basename(raw);
  const stem = base.replace(/\.ya?ml$/, '');
  const directory = path.dirname(path.relative(modelRoot, path.resolve(modelRoot, raw)));
  const sameName = relativeFiles.filter((candidate) => path.basename(candidate) === base);
  const sameDirectory = relativeFiles.filter((candidate) => directory !== '.' && path.dirname(candidate) === directory);
  const sameStem = relativeFiles.filter((candidate) => stem && candidate.includes(stem));
  const similar = [sameName, sameDirectory, sameStem].find((list) => list.length > 0) ?? [];
  const shown = (similar.length > 0 ? similar : relativeFiles).slice(0, CANDIDATE_LIMIT);
  const label = similar.length > 0 ? 'Similar files' : `Files carrying entities (${relativeFiles.length}), first ${shown.length}`;
  throw new Error(
    `--file ${raw} selects nothing measurable. Paths are relative to the model root (${modelRoot}).`
    + ` ${label}: ${shown.join(', ')}`,
  );
}
