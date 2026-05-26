/**
 * Apply entity-level migration changes: add, modify, deprecate, remove, split, merge.
 */
import type { BlueprintModel, Entity } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from '../../extraction/entities/id.js';
import { MigrationError } from '../migrationError.js';
import { findEntityByRef } from '../migrationApplyUtils.js';

// ---------------------------------------------------------------------------
// Entity-type mapping: migration entity_type → core Entity type + layer
// ---------------------------------------------------------------------------

interface TypeMapping {
  type: string;
  layer: string;
}

export const MIGRATION_ENTITY_TYPE_MAP: Record<string, TypeMapping> = {
  concept:          { type: ENTITY_TYPE.Concept,            layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  actor:            { type: ENTITY_TYPE.Actor,              layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  enumeration:      { type: ENTITY_TYPE.Enumeration,        layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  association:      { type: ENTITY_TYPE.Association,         layer: SCHEMA_TYPE_TO_LAYER['concepts']! },
  operation:        { type: ENTITY_TYPE.Operation,           layer: SCHEMA_TYPE_TO_LAYER['domain']! },
  error:            { type: ENTITY_TYPE.Operation,           layer: SCHEMA_TYPE_TO_LAYER['domain']! },
  rule:             { type: ENTITY_TYPE.StructuralRule,      layer: SCHEMA_TYPE_TO_LAYER['rules']! },
  transition:       { type: ENTITY_TYPE.TransitionRule,      layer: SCHEMA_TYPE_TO_LAYER['rules']! },
  model:            { type: ENTITY_TYPE.Models,              layer: SCHEMA_TYPE_TO_LAYER['models']! },
  story:            { type: ENTITY_TYPE.Story,               layer: SCHEMA_TYPE_TO_LAYER['story']! },
  activity:         { type: ENTITY_TYPE.Story,               layer: SCHEMA_TYPE_TO_LAYER['story']! },
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
  goal:             { type: ENTITY_TYPE.Goal,                layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  'non-goal':       { type: ENTITY_TYPE.NonGoal,             layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  risk:             { type: ENTITY_TYPE.Risk,                layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  assumption:       { type: ENTITY_TYPE.Assumption,          layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  'trade-off':      { type: ENTITY_TYPE.TradeOff,            layer: SCHEMA_TYPE_TO_LAYER['motivation']! },
  decision:         { type: ENTITY_TYPE.Decision,            layer: SCHEMA_TYPE_TO_LAYER['decisions']! },
  capability:       { type: ENTITY_TYPE.Capability,          layer: SCHEMA_TYPE_TO_LAYER['capability']! },
  'test-case':      { type: ENTITY_TYPE.TestCase,            layer: SCHEMA_TYPE_TO_LAYER['test-cases']! },
  'fitness-function': { type: ENTITY_TYPE.TestCase,          layer: SCHEMA_TYPE_TO_LAYER['test-cases']! },
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
): Entity {
  const displayId = String(after.id ?? '');
  const mapping = resolveEntityType(entityType, displayId);
  const id = makeInternalId(undefined, migrationFilePath, displayId);
  return {
    id,
    displayId,
    type: mapping.type,
    layer: mapping.layer,
    fileOrigin: migrationFilePath,
    term: strOrUndef(after.term) ?? strOrUndef(after.name),
    summary: strOrUndef(after.summary),
    description: strOrUndef(after.definition) ?? strOrUndef(after.description),
    data: after,
  };
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
        const entity = entityFromAfter(after, entityType, migrationFilePath);
        model.entities.push(entity);
        break;
      }
      case 'modify': {
        const entity = findEntityByRef(target, model.entities);
        if (!entity) throw new MigrationError(`Entity modify: target not found: ${target}`);
        const after = change.after as Record<string, unknown> | undefined;
        if (!after) throw new MigrationError(`Entity modify: missing 'after' for target ${target}`);
        entity.data = after;
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
        const first = afterArr[0] as Record<string, unknown>;
        entity.data = first;
        if (first.term != null) entity.term = String(first.term);
        if (first.name != null && entity.term == null) entity.term = String(first.name);
        if (first.summary != null) entity.summary = String(first.summary);
        if (first.definition != null) entity.description = String(first.definition);
        else if (first.description != null) entity.description = String(first.description);
        if (first.id != null && String(first.id) !== entity.displayId) {
          entity.displayId = String(first.id);
          entity.id = makeInternalId(undefined, migrationFilePath, entity.displayId);
        }
        for (let i = 1; i < afterArr.length; i++) {
          const item = afterArr[i] as Record<string, unknown>;
          const newEntity = entityFromAfter(item, entityType, migrationFilePath);
          model.entities.push(newEntity);
        }
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
        for (const ref of sourceRefs) {
          const entity = findEntityByRef(ref, model.entities);
          if (!entity) throw new MigrationError(`Entity merge: source not found: ${ref}`);
          sourceIds.push(entity.id);
        }
        model.entities = model.entities.filter((e) => !sourceIds.includes(e.id));
        model.relations = model.relations.filter(
          (r) => !sourceIds.includes(r.source_entity_id) && !sourceIds.includes(r.target_entity_id),
        );
        const mergedEntity = entityFromAfter(after, entityType, migrationFilePath);
        model.entities.push(mergedEntity);
        break;
      }
      default:
        throw new MigrationError(`Unknown entity change kind: ${kind}`);
    }
  }
}
