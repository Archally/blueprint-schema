/**
 * An owner stated by name alone whose name matches a declared team, department or party.
 *
 * `owned_by` may name the accountable unit by a reference (`team`, `department` or `party`), by a
 * `name`, or both. A name alone is how a model states an owner before the unit is declared. Once a
 * unit with that name is declared, the reference can be written, and this rule says which one.
 *
 * **Matching is exact after normalising**: Unicode NFC, runs of whitespace collapsed to one space,
 * trimmed, lower-cased. No fuzzy matching, so a finding is never a guess. A unit is identified by
 * its arm and its declared `id`; a unit declared without an `id` cannot be referenced and is not a
 * candidate. A unit declared in several places with one id is one candidate.
 *
 * **One finding per statement.** An entity's own `owned_by` is reported on that entity. A file-level
 * default reaches every entity that inherits it under `_owned_by_default`, so it is reported once
 * per file, on the inheriting entity whose id sorts first, and the message says how many inherit
 * it. An `owned_by` object shared by several entities is reported once.
 *
 * The rule reads the built model through the engine's `check.custom` hook with `find: { all: true }`:
 * every finding is computed once per model and attributed to its reporting entity.
 */

const OWNED_BY_DEFAULT = '_owned_by_default';

/** The reference arms of `owned_by` and the entity type each names, in schema order. */
const ARMS = [
  ['team', 'Team'],
  ['department', 'Department'],
  ['party', 'Party'],
];
const ARM_BY_TYPE = new Map(ARMS.map(([arm, type]) => [type, arm]));

/** One result per model, however many entities the engine walks. */
const cache = new WeakMap();

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * The comparison form of a name: NFC, whitespace collapsed, trimmed, lower-cased.
 * @param {string} value
 */
export function normaliseOwnerName(value) {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** @param {Record<string, unknown>} ownedBy @returns {string | undefined} the name of a name-only statement */
function nameOnly(ownedBy) {
  if (ARMS.some(([arm]) => typeof ownedBy[arm] === 'string' && ownedBy[arm] !== '')) return undefined;
  const name = ownedBy.name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
}

/** Declared teams, departments and parties, by normalised name. */
function unitsByName(entities) {
  /** @type {Map<string, Map<string, { arm: string, id: string, name: string }>>} */
  const byName = new Map();
  for (const entity of entities) {
    const arm = ARM_BY_TYPE.get(entity.type);
    if (arm === undefined) continue;
    const data = asObject(entity.data) ?? {};
    const id = data.id;
    const name = typeof data.name === 'string' ? data.name : entity.name;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name.trim() === '') continue;
    const key = normaliseOwnerName(name);
    if (!byName.has(key)) byName.set(key, new Map());
    byName.get(key).set(`${arm}\u0000${id}`, { arm, id, name: name.trim() });
  }
  return byName;
}

/** @param {{ arm: string, id: string, name: string }} unit */
const describeUnit = (unit) => `${unit.arm} ${unit.id} ("${unit.name}")`;

/** The `{match}` clause: the one unit and its reference, or every candidate. */
function matchClause(units) {
  if (units.length === 1) {
    const [unit] = units;
    return `matches the declared ${describeUnit(unit)}: write owned_by: { ${unit.arm}: ${unit.id} } to link it.`;
  }
  return `matches ${units.length} declared units, ${units.map(describeUnit).join(', ')}: write the reference to the one meant.`;
}

const compareIds = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Reporting entity id -> message context. */
function findings(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  const entities = [...(model.entities ?? [])].sort(compareIds);
  const units = unitsByName(entities);
  const result = new Map();
  const seenStatements = new WeakSet();
  /** file -> { reporter, name, inheritors } */
  const fileDefaults = new Map();

  const candidates = (name) =>
    [...(units.get(normaliseOwnerName(name))?.values() ?? [])].sort(
      (a, b) => a.arm.localeCompare(b.arm) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  for (const entity of entities) {
    const data = asObject(entity.data);
    if (!data) continue;
    const own = asObject(data.owned_by);
    if (own) {
      if (seenStatements.has(own)) continue;
      seenStatements.add(own);
      const name = nameOnly(own);
      if (name === undefined) continue;
      const matched = candidates(name);
      if (matched.length === 0) continue;
      result.set(entity.id, {
        statement: `${entity.type} ${entity.displayId ?? entity.id}`,
        ownerName: name,
        match: matchClause(matched),
      });
      continue;
    }
    const inherited = asObject(data[OWNED_BY_DEFAULT]);
    if (!inherited) continue;
    const name = nameOnly(inherited);
    if (name === undefined) continue;
    const file = entity.fileOrigin ?? '';
    const entry = fileDefaults.get(file);
    if (entry) entry.inheritors += 1;
    else fileDefaults.set(file, { reporter: entity, name, inheritors: 1 });
  }

  for (const [file, { reporter, name, inheritors }] of fileDefaults) {
    const matched = candidates(name);
    if (matched.length === 0) continue;
    const label = file === '' ? 'The file-level owned_by' : `The file-level owned_by of ${file}`;
    result.set(reporter.id, {
      statement: `${label}, inherited by ${inheritors} ${inheritors === 1 ? 'entity' : 'entities'},`,
      ownerName: name,
      match: matchClause(matched),
    });
  }

  cache.set(model, result);
  return result;
}

/** @param {any} model @param {any} subject */
export const ownerNameMatchesDeclaredUnit = (model, subject) => {
  const context = findings(model).get(subject.id);
  return context ? { ok: false, context } : { ok: true };
};
