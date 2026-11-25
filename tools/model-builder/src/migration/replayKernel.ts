/** Pure model replay primitives shared between Blueprint and Realm adapters. No loaders or domain DTOs. */
export interface ReplayEntry {
  id: string;
  filePath?: string;
  dependsOn: string[];
}
export interface ReplayDocument extends ReplayEntry {
  data: Record<string, unknown>;
}
export interface Diagnostic {
  path: string;
  message: string;
}
export interface ReplayValidation {
  valid: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/**
 * Error thrown when migration application fails (invalid target, missing data, etc.).
 */
export class MigrationError extends Error {
  public migrationId?: string;
  public changeIndex?: number;

  constructor(message: string, migrationId?: string, changeIndex?: number) {
    super(message);
    this.name = 'MigrationError';
    this.migrationId = migrationId;
    this.changeIndex = changeIndex;
  }
}

export function getNestedProperty(object: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = object;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedProperty(object: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = object;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] == null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

export function deleteNestedProperty(object: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = object;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] == null || typeof current[part] !== 'object') return;
    current = current[part] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]!];
}

/** Blueprint-compatible topology: only the initial ready queue is sorted; external deps are skipped. */
export function orderReplay<Entry extends ReplayEntry>(migrations: Entry[]): Entry[] {
  if (migrations.length <= 1) return [...migrations];

  const byId = new Map<string, Entry>();
  for (const migration of migrations) byId.set(migration.id, migration);

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const migration of migrations) {
    inDegree.set(migration.id, 0);
    dependents.set(migration.id, []);
  }

  for (const migration of migrations) {
    for (const dependencyId of migration.dependsOn) {
      if (!byId.has(dependencyId)) continue; // external prerequisite - adapter decides whether it is satisfied
      inDegree.set(migration.id, (inDegree.get(migration.id) ?? 0) + 1);
      dependents.get(dependencyId)!.push(migration.id);
    }
  }

  const queue = migrations
    .filter((migration) => (inDegree.get(migration.id) ?? 0) === 0)
    .sort((left, right) => (left.filePath ?? left.id).localeCompare(right.filePath ?? right.id))
    .map((migration) => migration.id);

  const result: Entry[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(byId.get(id)!);
    for (const dependentId of dependents.get(id) ?? []) {
      const degree = (inDegree.get(dependentId) ?? 1) - 1;
      inDegree.set(dependentId, degree);
      if (degree === 0) queue.push(dependentId);
    }
  }

  if (result.length !== migrations.length) {
    const stuck = migrations
      .filter((migration) => !result.some((orderedMigration) => orderedMigration.id === migration.id))
      .map((migration) => migration.id);
    throw new MigrationError(`Circular dependency: ${stuck.join(', ')}`);
  }
  return result;
}

export function sortByOrder(changes: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...changes].sort((left, right) => {
    const leftOrder = typeof left.order === 'number' ? left.order : Infinity;
    const rightOrder = typeof right.order === 'number' ? right.order : Infinity;
    return leftOrder - rightOrder;
  });
}

function pathFor(path: string, message: string): Diagnostic {
  return { path, message };
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

export function expandAtomicGroupErrors(
  migration: ReplayDocument,
  errors: Array<{ path: string; message: string }>,
): Array<{ path: string; message: string }> {
  const changes = migration.data.changes as Record<string, unknown> | undefined;
  if (!changes) return errors;
  const allChanges: Array<{ path: string; group?: string }> = [];
  asRecordArray(changes.entities).forEach((change, i) =>
    allChanges.push({ path: `${migration.id}/entities/${i}`, group: change.group as string | undefined }),
  );
  asRecordArray(changes.properties).forEach((change, i) =>
    allChanges.push({ path: `${migration.id}/properties/${i}`, group: change.group as string | undefined }),
  );
  asRecordArray(changes.relationships).forEach((change, i) =>
    allChanges.push({ path: `${migration.id}/relationships/${i}`, group: change.group as string | undefined }),
  );
  asRecordArray(changes.meta).forEach((change, i) =>
    allChanges.push({ path: `${migration.id}/meta/${i}`, group: change.group as string | undefined }),
  );
  const errorPaths = new Set(errors.map((error) => error.path));
  const byGroup = new Map<string, typeof allChanges>();
  for (const change of allChanges) {
    if (change.group) {
      if (!byGroup.has(change.group)) byGroup.set(change.group, []);
      byGroup.get(change.group)!.push(change);
    }
  }
  const added: Array<{ path: string; message: string }> = [];
  for (const error of errors) {
    const change = allChanges.find((item) => item.path === error.path);
    if (change?.group) {
      const groupChanges = byGroup.get(change.group) ?? [];
      for (const groupChange of groupChanges) {
        if (!errorPaths.has(groupChange.path)) {
          added.push(pathFor(groupChange.path, `Atomic group '${change.group}' failed (see ${error.path})`));
          errorPaths.add(groupChange.path);
        }
      }
    }
  }
  return [...errors, ...added];
}

export function selectByStatus<T extends { status: string }>(
  migrations: readonly T[],
  statuses: readonly string[] | null | undefined,
): T[] {
  // `null` is no filter. An EMPTY array is a filter that selects nothing, and collapsing the two
  // would turn "the user excluded every status" into "the user filtered nothing" - the one
  // substitution a build filter must never make, because it renders a full model in answer to an
  // empty selection.
  if (statuses === null || statuses === undefined) return [...migrations];
  const wanted = new Set(statuses.map((status) => status.toLowerCase()));
  return migrations.filter((migration) => wanted.has(migration.status.toLowerCase()));
}

export function findUnsatisfiedPrerequisite<Entry extends ReplayEntry>(
  selected: readonly Entry[],
  pending: readonly Entry[],
): { migration: Entry; prerequisite: Entry } | null {
  const selectedIds = new Set(selected.map((migration) => migration.id));
  const pendingById = new Map(pending.map((migration) => [migration.id, migration]));
  for (const migration of selected) {
    for (const dependencyId of migration.dependsOn ?? []) {
      if (selectedIds.has(dependencyId)) continue;
      const prerequisite = pendingById.get(dependencyId);
      // Not pending at all means it is already in the base - satisfied, not missing.
      if (prerequisite) return { migration, prerequisite };
    }
  }
  return null;
}

export function transitiveDependencyClosure<Entry extends ReplayEntry>(
  allOrdered: readonly Entry[],
  migrationId: string,
): Set<string> {
  const byId = new Map(allOrdered.map((migration) => [migration.id, migration]));
  const closure = new Set<string>();
  const stack = [migrationId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (closure.has(id)) continue;
    closure.add(id);
    for (const dependencyId of byId.get(id)?.dependsOn ?? []) {
      if (!closure.has(dependencyId)) stack.push(dependencyId);
    }
  }
  return closure;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (key) =>
          JSON.stringify(key) +
          ':' +
          stableStringify((value as Record<string, unknown>)[key]),
      )
      .join(',') +
    '}'
  );
}

/** Apply a property operation; guarded old-value policy belongs to the adapter. */
export function applyPropertyChange(
  data: Record<string, unknown>,
  change: Record<string, unknown>,
  onSet?: (property: string, value: unknown) => void,
): void {
  const kind = String(change.kind ?? '');
  const target = String(change.target ?? '');
  const property = String(change.property ?? '');
  switch (kind) {
    case 'set': {
      setNestedProperty(data, property, change.value);
      onSet?.(property, change.value);
      break;
    }
    case 'unset': {
      deleteNestedProperty(data, property);
      break;
    }
    case 'rename': {
      const newName = String(change.new_name ?? '');
      if (!newName) throw new MigrationError(`Property rename: missing new_name for ${target}.${property}`);
      const value = getNestedProperty(data, property);
      deleteNestedProperty(data, property);
      setNestedProperty(data, newName, value);
      break;
    }
    case 'append': {
      const list = getNestedProperty(data, property);
      if (Array.isArray(list)) {
        list.push(change.value);
      } else {
        setNestedProperty(data, property, [change.value]);
      }
      break;
    }
    case 'remove-item': {
      const list = getNestedProperty(data, property);
      if (Array.isArray(list)) {
        const value = change.value;
        const index = list.findIndex((item) =>
          typeof item === 'object' && item !== null
            ? JSON.stringify(item) === JSON.stringify(value)
            : item === value,
        );
        if (index >= 0) list.splice(index, 1);
      }
      break;
    }
    default:
      throw new MigrationError(`Unknown property change kind: ${kind}`);
  }
}

export interface ReplayAdapter<Model, Entry extends ReplayEntry, Derived> {
  initialize(model: Model): Derived;
  validate(model: Model, migration: Entry): { errors: Diagnostic[]; warnings: Diagnostic[] };
  expandErrors(migration: Entry, errors: Diagnostic[]): Diagnostic[];
  apply(model: Model, migration: Entry): void;
  rebuild(model: Model, derived: Derived): Derived;
}

/** Clone, validate, apply and rebuild through domain hooks. A refused batch returns no model. */
export function replayValidated<Model, Entry extends ReplayEntry, Derived>(
  baseModel: Model,
  ordered: Entry[],
  adapter: ReplayAdapter<Model, Entry, Derived>,
): { validation: ReplayValidation; model: Model | null } {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const workingModel = structuredClone(baseModel);
  let derived = adapter.initialize(workingModel);
  for (const migration of ordered) {
    const validation = adapter.validate(workingModel, migration);
    warnings.push(...validation.warnings);
    if (validation.errors.length > 0) {
      errors.push(...adapter.expandErrors(migration, validation.errors));
      return { validation: { valid: false, errors, warnings }, model: null };
    }
    try {
      adapter.apply(workingModel, migration);
      derived = adapter.rebuild(workingModel, derived);
    } catch (error) {
      const message = error instanceof MigrationError ? error.message : String(error);
      errors.push({ path: migration.id, message: `Apply failed: ${message}` });
      return { validation: { valid: false, errors, warnings }, model: null };
    }
  }
  return { validation: { valid: true, errors, warnings }, model: workingModel };
}

export type ChangePhase = 'entities' | 'properties' | 'relationships' | 'meta';

/** Shared phase dispatch; placement, identity and edge semantics stay in hooks. */
export function applyChangePhases(
  changes: Record<string, unknown>,
  handlers: Record<ChangePhase, (operations: Record<string, unknown>[]) => void>,
): void {
  // Capture all phases before invoking handlers, preserving the existing dispatcher semantics.
  const operationsByPhase = {
    entities: asRecordArray(changes.entities),
    properties: asRecordArray(changes.properties),
    relationships: asRecordArray(changes.relationships),
    meta: asRecordArray(changes.meta),
  };
  for (const phase of ['entities', 'properties', 'relationships', 'meta'] as const) {
    const operations = operationsByPhase[phase];
    if (operations.length > 0) {
      handlers[phase](sortByOrder(operations));
    }
  }
}

/** The adapter must supply a pure attempt. On refusal, retain only the successful prefix. */
export function replayUntilHalt<Model, Entry extends ReplayEntry>(
  baseModel: Model,
  ordered: Entry[],
  materializedIds: string[],
  apply: (model: Model, migration: Entry, appliedIds: string[]) => Model,
  isInvalid: (model: Model) => boolean,
): { model: Model; appliedIds: string[]; haltedAt: string | null; failedAttempt: Model | null } {
  const appliedIds = [...materializedIds];
  let model = baseModel;
  for (const migration of ordered) {
    const attempt = apply(model, migration, appliedIds);
    if (isInvalid(attempt)) {
      return { model, appliedIds, haltedAt: migration.id, failedAttempt: attempt };
    }
    model = attempt;
    appliedIds.push(migration.id);
  }
  return { model, appliedIds, haltedAt: null, failedAttempt: null };
}
