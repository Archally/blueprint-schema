import { orderReplay as topoSort, expandAtomicGroupErrors, replayValidated, applyChangePhases } from './replayKernel.js';
import type {
  BlueprintModel,
  Entity,
  MigrationValidationResult,
} from '../model/types.js';
import { resolveRef } from '../extraction/relations/resolver.js';
import { MigrationError } from './migrationError.js';
import { findEntityByRef, getNestedProperty } from './migrationApplyUtils.js';
import { applyEntityChanges } from './changes/applyEntityChanges.js';
import { applyPropertyChanges } from './changes/applyPropertyChanges.js';
import { applyRelationshipChanges } from './changes/applyRelationshipChanges.js';
import { normalizeRelationshipPredicate } from './changes/applyRelationshipChanges.js';
import { applyMetaChanges } from './changes/applyMetaChanges.js';
import { deriveFrom, rederiveRelations } from './rederiveRelations.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A migration ready for application. Compatible with MigrationInfo from the
 * backend loader — only the fields the engine needs.
 */
export interface MigrationToApply {
  /** Migration ID (e.g. "MIG001"). */
  id: string;
  /** File path of this migration (used as fileOrigin for added entities). */
  filePath?: string;
  /** Migration IDs that must be applied before this one. */
  dependsOn: string[];
  /** Full parsed migration document: { migration, changes, rollback? }. */
  data: Record<string, unknown>;
}

export { MigrationError };

// ---------------------------------------------------------------------------
// Migration validation (step-03)
// ---------------------------------------------------------------------------

function pathFor(path: string, message: string): { path: string; message: string } {
  return { path, message };
}

function asRecordArrayForValidation(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

/**
 * Check that every depends_on reference is in appliedIds or in the set of migrations we're applying.
 * Returns errors for missing refs.
 */
function validateDependsOn(
  migrations: MigrationToApply[],
  appliedIds: Set<string>,
): Array<{ path: string; message: string }> {
  const toApplyIds = new Set(migrations.map((m) => m.id));
  const allowed = new Set<string>([...appliedIds, ...toApplyIds]);
  const errors: Array<{ path: string; message: string }> = [];
  for (const m of migrations) {
    for (const dep of m.dependsOn) {
      if (!allowed.has(dep)) {
        errors.push(pathFor(`${m.id}/migration.depends_on`, `depends_on references non-existent migration: ${dep}`));
      }
    }
  }
  return errors;
}

/**
 * Detect cycles in depends_on. Uses topoSort; on cycle returns one error.
 */
function validateNoCycle(
  migrations: MigrationToApply[],
): Array<{ path: string; message: string }> {
  try {
    topoSort(migrations);
    return [];
  } catch (err) {
    const message = err instanceof MigrationError ? err.message : String(err);
    return [pathFor('migrations', `Circular depends_on: ${message}`)];
  }
}

/**
 * Collect (migrationId, target, property) for property changes and entity modify.
 * Used for conflict detection.
 */
function collectPropertyTouches(migrations: MigrationToApply[]): Map<string, Array<{ migId: string; target: string; property: string }>> {
  const byKey = new Map<string, Array<{ migId: string; target: string; property: string }>>();
  function add(migId: string, target: string, property: string) {
    const key = `${target}\t${property}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ migId, target, property });
  }
  for (const m of migrations) {
    const changes = m.data.changes as Record<string, unknown> | undefined;
    if (!changes) continue;
    const props = asRecordArrayForValidation(changes.properties);
    for (const ch of props) {
      const target = String(ch.target ?? '');
      const property = String(ch.property ?? '');
      if (ch.kind === 'set' || ch.kind === 'unset' || ch.kind === 'rename') add(m.id, target, property);
    }
    const entities = asRecordArrayForValidation(changes.entities);
    for (const ch of entities) {
      if (String(ch.kind ?? '') === 'modify') add(m.id, String(ch.target ?? ''), 'entity');
    }
  }
  return byKey;
}

/**
 * Two migrations conflict on (entity, property) if neither depends on the other.
 */
function detectConflicts(
  migrations: MigrationToApply[],
): Array<{ path: string; message: string }> {
  const byId = new Map<string, MigrationToApply>();
  for (const m of migrations) byId.set(m.id, m);
  const ordered = topoSort(migrations);
  const orderIndex = new Map<string, number>();
  ordered.forEach((m, i) => orderIndex.set(m.id, i));
  function hasOrdering(a: string, b: string): boolean {
    const ia = orderIndex.get(a) ?? -1;
    const ib = orderIndex.get(b) ?? -1;
    if (ia < 0 || ib < 0) return false;
    return ia < ib || ib < ia;
  }
  function dependsOn(a: string, b: string): boolean {
    const ma = byId.get(a);
    return ma ? ma.dependsOn.includes(b) : false;
  }
  const touches = collectPropertyTouches(migrations);
  const errors: Array<{ path: string; message: string }> = [];
  for (const [, list] of touches) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!.migId;
        const b = list[j]!.migId;
        if (!dependsOn(a, b) && !dependsOn(b, a)) {
          errors.push(pathFor(
            `${a}`,
            `Same entity+property modified by ${a} and ${b} without depends_on ordering`,
          ));
        }
      }
    }
  }
  return errors;
}

/**
 * Validate a single migration's changes against the current model; collect errors and warnings.
 * Does not mutate model. Caller is responsible for atomic group expansion.
 */
function validateMigrationChanges(
  model: BlueprintModel,
  migration: MigrationToApply,
  errors: Array<{ path: string; message: string }>,
  warnings: Array<{ path: string; message: string }>,
): void {
  const changes = migration.data.changes as Record<string, unknown> | undefined;
  if (!changes) return;
  const pathPrefix = migration.id;

  const entityChanges = asRecordArrayForValidation(changes.entities);
  const propertyChanges = asRecordArrayForValidation(changes.properties);
  const relationshipChanges = asRecordArrayForValidation(changes.relationships);
  const metaChanges = asRecordArrayForValidation(changes.meta);

  for (let i = 0; i < entityChanges.length; i++) {
    const ch = entityChanges[i]!;
    const kind = String(ch.kind ?? '');
    const target = String(ch.target ?? '');
    const p = `${pathPrefix}/entities/${i}`;
    if (kind === 'add') {
      const after = ch.after as Record<string, unknown> | undefined;
      const newId = after && (after.id != null) ? String(after.id) : target;
      const existing = findEntityByRef(newId, model.entities);
      if (existing) {
        errors.push(pathFor(p, `Entity add targets existing ID: ${newId}`));
      }
      if (ch.before != null && kind === 'add') {
        warnings.push(pathFor(p, 'add with before (ignored)'));
      }
    } else if (kind === 'modify' || kind === 'remove' || kind === 'deprecate' || kind === 'split' || kind === 'merge' || kind === 'move') {
      if (kind === 'merge') {
        const sourceRefs = target.split(',').map((s) => s.trim()).filter(Boolean);
        if (sourceRefs.length < 2) {
          errors.push(pathFor(p, `Entity merge target must be comma-separated IDs (≥2), got: ${target}`));
        } else {
          for (const ref of sourceRefs) {
            if (!findEntityByRef(ref, model.entities)) {
              errors.push(pathFor(p, `Entity merge source not found: ${ref}`));
            }
          }
        }
      } else {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) {
          errors.push(pathFor(p, `Entity ${kind} targets non-existent ID: ${target}`));
        } else if ((kind === 'modify' || kind === 'remove') && ch.before != null) {
          const before = ch.before as Record<string, unknown>;
          const data = entity.data ?? {};
          const currentValue = (key: string): unknown => {
            if (key === 'id') return data.id ?? entity.displayId;
            if (key === 'term' || key === 'name') return entity.term ?? data.term ?? data.name;
            if (key === 'definition' || key === 'description') return entity.description ?? data.definition ?? data.description;
            if (key === 'summary') return entity.summary ?? data.summary;
            return data[key];
          };
          for (const key of Object.keys(before)) {
            const expected = before[key];
            const actual = currentValue(key);
            if (actual !== expected && JSON.stringify(actual) !== JSON.stringify(expected)) {
              errors.push(pathFor(p, `before.${key} mismatches current state for ${target}`));
            }
          }
        }
      }
      if (kind === 'remove' && ch.before == null) {
        warnings.push(pathFor(p, 'remove without before (incomplete rollback)'));
      }
    }
  }

  for (let i = 0; i < propertyChanges.length; i++) {
    const ch = propertyChanges[i]!;
    const kind = String(ch.kind ?? '');
    const target = String(ch.target ?? '');
    const property = String(ch.property ?? '');
    const p = `${pathPrefix}/properties/${i}`;
    const entity = findEntityByRef(target, model.entities);
    if (!entity) {
      errors.push(pathFor(p, `Property ${kind} targets non-existent entity: ${target}`));
      continue;
    }
    const current = getNestedProperty(entity.data ?? {}, property);
    if (kind === 'set' && ch.old_value !== undefined) {
      if (JSON.stringify(current) !== JSON.stringify(ch.old_value)) {
        errors.push(pathFor(p, `old_value mismatches current state for ${target}.${property}`));
      }
    }
    if (kind === 'set' && current === undefined && ch.old_value === undefined) {
      warnings.push(pathFor(p, 'set on new property without old_value'));
    }
  }

  for (let i = 0; i < relationshipChanges.length; i++) {
    const ch = relationshipChanges[i]!;
    const kind = String(ch.kind ?? '');
    const subject = String(ch.subject ?? '');
    const predicate = normalizeRelationshipPredicate(String(ch.predicate ?? ''));
    const object = String(ch.object ?? '');
    const p = `${pathPrefix}/relationships/${i}`;
    if (kind === 'add') {
      const sourceId = resolveRef(subject, 'default', model.entities);
      const targetId = resolveRef(object, 'default', model.entities);
      if (sourceId && targetId) {
        const relationId = `${sourceId}--${predicate}--${targetId}`;
        if (model.relations.some((r) => r.id === relationId)) {
          errors.push(pathFor(p, `Duplicate edge on add: ${subject} --${predicate}--> ${object}`));
        }
      }
    } else if (kind === 'remove' || kind === 'redirect') {
      const sourceId = resolveRef(subject, 'default', model.entities);
      const targetId = resolveRef(object, 'default', model.entities);
      if (sourceId && targetId) {
        const exists = model.relations.some(
          (r) =>
            r.source_entity_id === sourceId &&
            r.target_entity_id === targetId &&
            (r.type === predicate || r.predicate === predicate),
        );
        if (!exists) {
          errors.push(pathFor(p, `remove/redirect targets non-existent edge: ${subject} --${predicate}--> ${object}`));
        }
      } else if (!sourceId || !targetId) {
        errors.push(pathFor(p, `remove/redirect: subject or object entity not found`));
      }
    }
  }

  for (let i = 0; i < metaChanges.length; i++) {
    const ch = metaChanges[i]!;
    if (String(ch.kind ?? '') === 'bulk-tag') {
      const filter = ch.filter as Record<string, unknown> | undefined;
      const hasFilter = filter && (
        (filter.entity_type != null) ||
        (Array.isArray(filter.tags) && filter.tags.length > 0) ||
        (typeof filter.slice === 'string' && filter.slice.length > 0) ||
        (typeof filter.layer === 'string' && filter.layer.length > 0)
      );
      if (!hasFilter) {
        warnings.push(pathFor(`${pathPrefix}/meta/${i}`, 'bulk-tag with broad filter'));
      }
    }
  }

  const migMeta = (migration.data.migration ?? {}) as Record<string, unknown>;
  if (!Array.isArray(migMeta.related_decisions) || migMeta.related_decisions.length === 0) {
    warnings.push(pathFor(`${pathPrefix}/migration`, 'no related_decisions'));
  }
  if (typeof migMeta.rationale !== 'string' || !migMeta.rationale.trim()) {
    warnings.push(pathFor(`${pathPrefix}/migration`, 'no rationale'));
  }
}

/**
 * Validate migrations before apply. Returns validation result; does not mutate baseModel.
 * When valid is false, caller should not apply. When valid is true, warnings may still be present.
 */
export function validateMigrations(
  baseModel: BlueprintModel,
  migrationsToApply: MigrationToApply[],
  appliedIds: string[] = [],
): MigrationValidationResult {
  return validateAndApply(baseModel, migrationsToApply, appliedIds).validation;
}

/**
 * Validation applies every migration to a copy of the model to check the next one against it, so
 * when they are all valid that copy IS the migrated model. Returning it saves `applyMigrations` a
 * second pass, which matters since each migration re-derives the model's relations.
 */
function validateAndApply(
  baseModel: BlueprintModel,
  migrationsToApply: MigrationToApply[],
  appliedIds: string[],
): { validation: MigrationValidationResult; model: BlueprintModel | null } {
  const fail = (validation: MigrationValidationResult) => ({ validation, model: null });
  const errors: Array<{ path: string; message: string }> = [];
  const warnings: Array<{ path: string; message: string }> = [];
  const appliedSet = new Set(appliedIds);

  if (migrationsToApply.length === 0) {
    return { validation: { valid: true, errors: [], warnings: [] }, model: structuredClone(baseModel) };
  }

  errors.push(...validateDependsOn(migrationsToApply, appliedSet));
  const cycleErrors = validateNoCycle(migrationsToApply);
  errors.push(...cycleErrors);
  if (cycleErrors.length > 0) {
    return fail({ valid: false, errors, warnings });
  }
  errors.push(...detectConflicts(migrationsToApply));
  if (errors.length > 0) {
    return fail({ valid: false, errors, warnings });
  }

  let ordered: MigrationToApply[];
  try {
    ordered = topoSort(migrationsToApply);
  } catch {
    ordered = migrationsToApply;
  }
  return replayValidated(baseModel, ordered, {
    initialize: deriveFrom,
    validate: (workingModel, migration) => {
      const errors: Array<{ path: string; message: string }> = [];
      const warnings: Array<{ path: string; message: string }> = [];
      validateMigrationChanges(workingModel, migration, errors, warnings);
      return { errors, warnings };
    },
    expandErrors: expandAtomicGroupErrors,
    apply: applySingleMigration,
    rebuild: rederiveRelations,
  });
}

// ---------------------------------------------------------------------------
// Single migration application
// ---------------------------------------------------------------------------

function applySingleMigration(
  model: BlueprintModel,
  migration: MigrationToApply,
): void {
  const changes = migration.data.changes as Record<string, unknown> | undefined;
  if (!changes) return;

  try {
    applyChangePhases(changes, {
      entities: (operations) => applyEntityChanges(model, operations, migration.filePath),
      properties: (operations) => applyPropertyChanges(model, operations),
      relationships: (operations) => applyRelationshipChanges(model, operations, migration.filePath),
      meta: (operations) => applyMetaChanges(model, operations),
    });
  } catch (err) {
    if (err instanceof MigrationError) {
      err.migrationId = migration.id;
      throw err;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Apply migrations to a BlueprintModel, returning a new model.
 * The baseModel is NOT modified (deep-cloned first).
 *
 * Validation runs before apply. If validation fails, returns a copy of baseModel
 * with metadata.migrationValidation set to the validation result (no migrations applied).
 * If validation passes, applies migrations and attaches the validation result
 * (including any warnings) to result.metadata.migrationValidation.
 *
 * Migrations are topologically sorted by dependsOn before application.
 * Each migration's changes are applied in order: entities → properties →
 * relationships → meta, with explicit `order` fields respected within
 * each category. Every relation the build derives from entity data is then
 * re-derived from the migrated entities, as the build derives it (see
 * `rederiveRelations.ts`).
 *
 * @param appliedIds - Migration IDs already applied to produce baseModel (for depends_on validation).
 */
export function applyMigrations(
  baseModel: BlueprintModel,
  migrations: MigrationToApply[],
  appliedIds: string[] = [],
): BlueprintModel {
  if (migrations.length === 0) {
    return structuredClone(baseModel);
  }

  const { validation, model: migrated } = validateAndApply(baseModel, migrations, appliedIds);
  if (!validation.valid || !migrated) {
    const copy = structuredClone(baseModel);
    copy.metadata.migrationValidation = validation;
    return copy;
  }
  const model = migrated;

  // Update metadata counts and attach validation result (with warnings)
  model.metadata.total_entities = model.entities.length;
  model.metadata.total_relations = model.relations.length;
  model.metadata.migrationValidation = validation;

  return model;
}
