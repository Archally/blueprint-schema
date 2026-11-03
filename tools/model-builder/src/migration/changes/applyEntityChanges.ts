/**
 * Apply entity-level migration changes: add, modify, deprecate, remove, split, merge.
 */
import type { BlueprintModel, Entity } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from '../../extraction/entities/id.js';
import { MigrationError } from '../migrationError.js';
import { findEntityByRef } from '../migrationApplyUtils.js';
import { resolveSchemaLine } from '../../extraction/entities/ownershipDefaults.js';
import { declaredKeyOf, keepDocumentKeys, placeAsWritten, writtenFileOf } from './placeAsWritten.js';

// ---------------------------------------------------------------------------
// Entity-type mapping: migration entity_type → core Entity type + layer
// ---------------------------------------------------------------------------

interface TypeMapping {
  type: string;
  layer: string;
}

/**
 * A migration names the kind of entity it adds; this map says which entity type that becomes.
 *
 * It is the SECOND route an entity can enter the model by. The first is a file: an `errors:` entry
 * in a domain document is typed by the extractor that reads it. Both routes must land on the same
 * type, and nothing but `applyEntityChanges.route-parity.test.ts` compares them - which is why that
 * test exists rather than a restatement of this table.
 *
 * Several kinds collapse onto one type on purpose, because no distinct type exists: a dependency is
 * a Service, a story and an activity are both a Process, and the three dynamics kinds share
 * Dynamics. Those are decisions, and the parity test names each one so that a future split is
 * noticed rather than assumed.
 */
export const MIGRATION_ENTITY_TYPE_MAP: Record<string, TypeMapping> = {
  concept:          { type: ENTITY_TYPE.Concept,            layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  actor:            { type: ENTITY_TYPE.Actor,              layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  enumeration:      { type: ENTITY_TYPE.Enumeration,        layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  association:      { type: ENTITY_TYPE.Association,         layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  operation:        { type: ENTITY_TYPE.Operation,           layer: SCHEMA_TYPE_TO_LAYER['domain']! },
  error:            { type: ENTITY_TYPE.Error,               layer: SCHEMA_TYPE_TO_LAYER['domain']! },
  rule:             { type: ENTITY_TYPE.StructuralRule,      layer: SCHEMA_TYPE_TO_LAYER['rules']! },
  transition:       { type: ENTITY_TYPE.TransitionRule,      layer: SCHEMA_TYPE_TO_LAYER['rules']! },
  model:            { type: ENTITY_TYPE.Models,              layer: SCHEMA_TYPE_TO_LAYER['models']! },
  story:            { type: ENTITY_TYPE.Process,               layer: SCHEMA_TYPE_TO_LAYER['story']! },
  activity:         { type: ENTITY_TYPE.Process,               layer: SCHEMA_TYPE_TO_LAYER['story']! },
  'user-story':     { type: ENTITY_TYPE.UserStory,           layer: SCHEMA_TYPE_TO_LAYER['story']! },
  'use-case':       { type: ENTITY_TYPE.UseCase,             layer: SCHEMA_TYPE_TO_LAYER['story']! },
  question:         { type: ENTITY_TYPE.Question,            layer: SCHEMA_TYPE_TO_LAYER['domain']! },
  inquiry:          { type: ENTITY_TYPE.Inquiry,             layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  party:            { type: ENTITY_TYPE.Party,               layer: SCHEMA_TYPE_TO_LAYER['org']! },
  department:       { type: ENTITY_TYPE.Department,          layer: SCHEMA_TYPE_TO_LAYER['org']! },
  team:             { type: ENTITY_TYPE.Team,                layer: SCHEMA_TYPE_TO_LAYER['org']! },
  context:          { type: ENTITY_TYPE.Context,             layer: SCHEMA_TYPE_TO_LAYER['arch']! },
  service:          { type: ENTITY_TYPE.Service,             layer: SCHEMA_TYPE_TO_LAYER['arch']! },
  contract:         { type: ENTITY_TYPE.Contract,            layer: SCHEMA_TYPE_TO_LAYER['arch']! },
  dependency:       { type: ENTITY_TYPE.Service,             layer: SCHEMA_TYPE_TO_LAYER['arch']! },
  package:          { type: ENTITY_TYPE.Package,             layer: SCHEMA_TYPE_TO_LAYER['arch']! },
  goal:             { type: ENTITY_TYPE.Goal,                layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  'non-goal':       { type: ENTITY_TYPE.NonGoal,             layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  risk:             { type: ENTITY_TYPE.Risk,                layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  assumption:       { type: ENTITY_TYPE.Assumption,          layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  'trade-off':      { type: ENTITY_TYPE.TradeOff,            layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  decision:         { type: ENTITY_TYPE.Decision,            layer: SCHEMA_TYPE_TO_LAYER['decisions']! },
  capability:       { type: ENTITY_TYPE.Capability,          layer: SCHEMA_TYPE_TO_LAYER['capability']! },
  'test-case':      { type: ENTITY_TYPE.TestCase,            layer: SCHEMA_TYPE_TO_LAYER['test-cases']! },
  'fitness-function': { type: ENTITY_TYPE.FitnessFunction,   layer: SCHEMA_TYPE_TO_LAYER['test-cases']! },
  metric:           { type: ENTITY_TYPE.Metric,              layer: SCHEMA_TYPE_TO_LAYER['quality']! },
  kpi:              { type: ENTITY_TYPE.KPI,                 layer: SCHEMA_TYPE_TO_LAYER['quality']! },
  slo:              { type: ENTITY_TYPE.SLO,                 layer: SCHEMA_TYPE_TO_LAYER['quality']! },
  sla:              { type: ENTITY_TYPE.SLA,                 layer: SCHEMA_TYPE_TO_LAYER['quality']! },
  security:         { type: ENTITY_TYPE.Security,            layer: SCHEMA_TYPE_TO_LAYER['quality']! },
  compliance:       { type: ENTITY_TYPE.Compliance,          layer: SCHEMA_TYPE_TO_LAYER['quality']! },
  resilience:       { type: ENTITY_TYPE.Resilience,          layer: SCHEMA_TYPE_TO_LAYER['quality']! },
  parallelism:      { type: ENTITY_TYPE.Dynamics,            layer: SCHEMA_TYPE_TO_LAYER['dynamics']! },
  ordering:         { type: ENTITY_TYPE.Dynamics,            layer: SCHEMA_TYPE_TO_LAYER['dynamics']! },
  'race-condition': { type: ENTITY_TYPE.Dynamics,            layer: SCHEMA_TYPE_TO_LAYER['dynamics']! },
  screen:           { type: ENTITY_TYPE.Screen,              layer: SCHEMA_TYPE_TO_LAYER['ui']! },
  'ui-action':      { type: ENTITY_TYPE.UIAction,            layer: SCHEMA_TYPE_TO_LAYER['ui']! },
  'ui-navigation':  { type: ENTITY_TYPE.UINavigation,        layer: SCHEMA_TYPE_TO_LAYER['ui']! },
  resource:         { type: ENTITY_TYPE.RG,                  layer: SCHEMA_TYPE_TO_LAYER['rg']! },
  milestone:        { type: ENTITY_TYPE.Milestone,           layer: SCHEMA_TYPE_TO_LAYER['roadmap']! },
  'value-stream':   { type: ENTITY_TYPE.ValueStream,         layer: SCHEMA_TYPE_TO_LAYER['value-stream']! },
};

const RULE_PREFIX_TO_TYPE: Record<string, string> = {
  SR:  ENTITY_TYPE.StructuralRule,
  CR:  ENTITY_TYPE.ClassificationRule,
  DR:  ENTITY_TYPE.DerivationRule,
  EQ:  ENTITY_TYPE.EquivalenceRule,
  VR:  ENTITY_TYPE.ValidationRule,
  TR:  ENTITY_TYPE.TransitionRule,
};

function strOrUndef(v: unknown): string | undefined {
  return v != null ? String(v) : undefined;
}

function declaredResourceLine(model: BlueprintModel): ReturnType<typeof resolveSchemaLine> | undefined {
  const version = model.metadata.schemaVersion;
  if (typeof version !== 'string') {
    return undefined;
  }
  if (!/^v?\d+\.\d+(?:\.\d+)?$/.test(version.trim())) {
    return undefined;
  }
  return resolveSchemaLine(version);
}

function resourceMapping(type: string): TypeMapping {
  return type === ENTITY_TYPE.InfraResource
    ? { type, layer: SCHEMA_TYPE_TO_LAYER['infrastructure']! }
    : MIGRATION_ENTITY_TYPE_MAP.resource!;
}

/** Source lineage wins; otherwise only documents at the inferred placement can select a route. */
function resolveResourceType(
  model: BlueprintModel,
  displayId: string,
  after: Record<string, unknown>,
  sources: Entity[],
): TypeMapping {
  const line = declaredResourceLine(model);
  const routes = new Set<string>();
  for (const source of sources) {
    if (
      source.type === ENTITY_TYPE.RG
      || source.type === ENTITY_TYPE.InfraResource
    ) {
      routes.add(source.type);
    }
  }
  if (sources.length === 0) {
    const prefix = displayId.includes('.') ? displayId.split('.')[0] : undefined;
    const explicitFile = typeof after._written_in === 'string' ? after._written_in : undefined;
    const resourceFiles = model.metadata.files.filter((file) =>
      file.schemaType === 'rg'
      || file.schemaType === 'infrastructure',
    );
    const inSlice = (path: string): boolean => {
      const parts = path.replace(/\\/g, '/').split('/');
      return prefix ? parts.slice(0, -1).includes(prefix) : parts.length === 1;
    };
    const siblings = model.entities.filter((entity) => {
      if (
        entity.type !== ENTITY_TYPE.RG
        && entity.type !== ENTITY_TYPE.InfraResource
      ) {
        return false;
      }
      if (explicitFile) {
        return writtenFileOf(entity) === explicitFile;
      }
      const siblingPrefix = entity.displayId.includes('.') ? entity.displayId.split('.')[0] : undefined;
      return siblingPrefix === prefix;
    });
    const siblingFiles = new Set(siblings.map(writtenFileOf));
    const placedFiles = resourceFiles.filter((file) => {
      if (explicitFile) {
        return file.path === explicitFile;
      }
      return inSlice(file.path)
        || siblingFiles.has(file.path);
    });
    const folderOf = (path: string): string => path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const rootFolders = new Set([
      '',
      ...model.metadata.files
        .filter((file) => file.schemaType === 'blueprint')
        .map((file) => folderOf(file.path)),
    ]);
    const hasPlacement = placedFiles.length > 0
      || siblings.length > 0
      || explicitFile;
    const applicableFiles = hasPlacement
      ? placedFiles
      : resourceFiles.filter((file) => rootFolders.has(folderOf(file.path)));
    for (const file of applicableFiles) {
      routes.add(file.schemaType === 'infrastructure' ? ENTITY_TYPE.InfraResource : ENTITY_TYPE.RG);
    }
    for (const sibling of siblings) {
      routes.add(sibling.type);
    }
  }
  if (routes.size > 1) {
    throw new MigrationError(`Entity resource: ambiguous resource routes for ${displayId}`);
  }
  const fallback = line
    && line !== 'v2.6'
      ? ENTITY_TYPE.InfraResource
      : ENTITY_TYPE.RG;
  const type = [...routes][0] ?? fallback;
  if (
    type === ENTITY_TYPE.InfraResource
    && line === 'v2.8'
  ) {
    if (!/^([a-z][a-z0-9-]*\.)?IR\d{3,}$/.test(displayId)) {
      throw new MigrationError(`Entity resource: invalid v2.8 infrastructure id ${displayId}`);
    }
  }
  return resourceMapping(type);
}

function resolveEntityType(entityType: string, displayId: string): TypeMapping {
  if (entityType === 'rule') {
    const prefixMatch = displayId.match(/^([A-Z]{2})\d/);
    if (prefixMatch) {
      const ruleType = RULE_PREFIX_TO_TYPE[prefixMatch[1]!];
      if (ruleType) {
        return { type: ruleType, layer: SCHEMA_TYPE_TO_LAYER['rules']! };
      }
    }
    return MIGRATION_ENTITY_TYPE_MAP['rule']!;
  }
  return MIGRATION_ENTITY_TYPE_MAP[entityType] ?? { type: entityType, layer: 'unknown' };
}

function entityFromAfter(
  after: Record<string, unknown>,
  entityType: string,
  migrationFilePath: string | undefined,
  target: string,
  model: BlueprintModel,
  sources: Entity[] = [],
): Entity {
  const displayId = declaredKeyOf(after, entityType, target);
  const mapping = entityType === 'resource'
    ? resolveResourceType(model, displayId, after, sources)
    : resolveEntityType(entityType, String(after.id ?? displayId));
  const id = makeInternalId(undefined, migrationFilePath, displayId);
  const entity: Entity = {
    id,
    displayId,
    type: mapping.type,
    layer: mapping.layer,
    fileOrigin: migrationFilePath,
    term: strOrUndef(after.term) ?? strOrUndef(after.name),
    summary: strOrUndef(after.summary),
    description: strOrUndef(after.definition) ?? strOrUndef(after.description),
    // A copy: a later property change edits the entity, and must not edit the migration document
    // the next replay of the same loaded set reads.
    data: structuredClone(after),
  };
  placeAsWritten(entity, model.entities);
  return entity;
}

// ---------------------------------------------------------------------------
// Apply: Entity changes
// ---------------------------------------------------------------------------

export function applyEntityChanges(
  model: BlueprintModel,
  changes: Record<string, unknown>[],
  migrationFilePath: string | undefined,
): void {
  for (const change of changes) {
    const kind = String(change.kind ?? '');
    const entityType = String(change.entity_type ?? '');
    const target = String(change.target ?? '');

    switch (kind) {
      case 'add': {
        const after = change.after as Record<string, unknown> | undefined;
        if (!after) throw new MigrationError(`Entity add: missing 'after' for target ${target}`);
        const entity = entityFromAfter(after, entityType, migrationFilePath, target, model);
        model.entities.push(entity);
        break;
      }
      case 'modify': {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) throw new MigrationError(`Entity modify: target not found: ${target}`);
        const after = change.after as Record<string, unknown> | undefined;
        if (!after) throw new MigrationError(`Entity modify: missing 'after' for target ${target}`);
        entity.data = keepDocumentKeys(entity.data, structuredClone(after));
        if (after.term != null) entity.term = String(after.term);
        if (after.name != null && entity.term == null) entity.term = String(after.name);
        if (after.summary != null) entity.summary = String(after.summary);
        if (after.definition != null) entity.description = String(after.definition);
        else if (after.description != null) entity.description = String(after.description);
        break;
      }
      case 'deprecate': {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) throw new MigrationError(`Entity deprecate: target not found: ${target}`);
        if (!entity.data) entity.data = {};
        entity.data.deprecated = true;
        break;
      }
      case 'remove': {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) throw new MigrationError(`Entity remove: target not found: ${target}`);
        const entityId = entity.id;
        model.entities = model.entities.filter((e) => e.id !== entityId);
        model.relations = model.relations.filter(
          (r) => r.source_entity_id !== entityId && r.target_entity_id !== entityId,
        );
        break;
      }
      case 'split': {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) throw new MigrationError(`Entity split: target not found: ${target}`);
        const afterArr = change.after;
        if (!Array.isArray(afterArr) || afterArr.length < 2) {
          throw new MigrationError(`Entity split: 'after' must be an array of ≥2 entities for target ${target}`);
        }
        const parts = afterArr as Record<string, unknown>[];
        // Each part's key, as an added entity is keyed; a first part that declares no key is the source.
        const partKeys = parts.map((part, index) =>
          declaredKeyOf(part, entityType, index === 0 ? entity.displayId : ''),
        );
        // The source keeps its id: the part keyed exactly as the source continues it, wherever it
        // sits. A split names its source among its parts; one that does not would rename the source
        // under another part's key, so it is refused and a full replacement is written as remove + add.
        const sourceParts = partKeys.flatMap((key, index) => (key === entity.displayId ? [index] : []));
        if (sourceParts.length > 1) {
          throw new MigrationError(`Entity split: ${sourceParts.length} parts are keyed as the source ${entity.displayId} for target ${target}`);
        }
        if (sourceParts.length === 0) {
          throw new MigrationError(
            `Entity split: no part is keyed as the source ${entity.displayId} for target ${target}; ` +
              `a split names its source among its parts (keyed as the source, or a first part with no key), ` +
              `and a full replacement is a 'remove' of the source plus an 'add' per new entity`,
          );
        }
        const keptIndex = sourceParts[0]!;
        const additions = parts.flatMap((item, index) => {
          if (index === keptIndex) {
            return [];
          }
          return [entityFromAfter(item, entityType, migrationFilePath, String(item.id ?? ''), model, [entity])];
        });
        const kept = parts[keptIndex]!;
        entity.data = keepDocumentKeys(entity.data, structuredClone(kept));
        if (kept.term != null) entity.term = String(kept.term);
        if (kept.name != null && entity.term == null) entity.term = String(kept.name);
        if (kept.summary != null) entity.summary = String(kept.summary);
        if (kept.definition != null) entity.description = String(kept.definition);
        else if (kept.description != null) entity.description = String(kept.description);
        model.entities.push(...additions);
        break;
      }
      case 'merge': {
        const sourceRefs = target.split(',').map((s) => s.trim()).filter(Boolean);
        if (sourceRefs.length < 2) {
          throw new MigrationError(`Entity merge: target must be comma-separated IDs (≥2), got: ${target}`);
        }
        const after = change.after as Record<string, unknown> | undefined;
        if (!after) throw new MigrationError(`Entity merge: missing 'after' for target ${target}`);
        const sourceIds: string[] = [];
        const sources: Entity[] = [];
        for (const ref of sourceRefs) {
          const entity = findEntityByRef(ref, model.entities);
          if (!entity) throw new MigrationError(`Entity merge: source not found: ${ref}`);
          sourceIds.push(entity.id);
          sources.push(entity);
        }
        const mergedEntity = entityFromAfter(after, entityType, migrationFilePath, String(after.id ?? ''), model, sources);
        model.entities = model.entities.filter((e) => !sourceIds.includes(e.id));
        model.relations = model.relations.filter(
          (r) => !sourceIds.includes(r.source_entity_id) && !sourceIds.includes(r.target_entity_id),
        );
        model.entities.push(mergedEntity);
        break;
      }
      default:
        throw new MigrationError(`Unknown entity change kind: ${kind}`);
    }
  }
}
