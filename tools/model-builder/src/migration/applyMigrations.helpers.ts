/**
 * Shared test helpers for applyMigrations test suite.
 * Used by applyMigrations.*.test.ts files.
 */
import type { MigrationToApply } from './applyMigrations.js';
import type { BlueprintModel, Entity, Relation } from '../model/types.js';

export function baseModel(
  entities: Entity[] = [],
  relations: Relation[] = [],
): BlueprintModel {
  return {
    entities,
    relations,
    metadata: {
      files: [],
      total_entities: entities.length,
      total_relations: relations.length,
      last_loaded: '2026-01-01T00:00:00Z',
    },
  };
}

export function conceptEntity(displayId: string, opts?: Partial<Entity>): Entity {
  return {
    id: `default-concepts.yaml-${displayId}`,
    displayId,
    type: 'Concept',
    layer: 'design.concepts',
    fileOrigin: 'concepts.yaml',
    term: opts?.term ?? displayId,
    data: opts?.data ?? { id: displayId, term: displayId },
    ...opts,
  };
}

export function operationEntity(displayId: string, opts?: Partial<Entity>): Entity {
  return {
    id: `default-domain.yaml-${displayId}`,
    displayId,
    type: 'Operation',
    layer: 'design.domain',
    fileOrigin: 'domain.yaml',
    term: opts?.term ?? displayId,
    data: opts?.data ?? { id: displayId, name: displayId },
    ...opts,
  };
}

export function makeRelation(sourceId: string, targetId: string, type: string): Relation {
  return {
    id: `${sourceId}--${type}--${targetId}`,
    source_entity_id: sourceId,
    target_entity_id: targetId,
    type,
  };
}

export function migration(
  id: string,
  changes: Record<string, unknown>,
  opts?: { dependsOn?: string[]; filePath?: string },
): MigrationToApply {
  return {
    id,
    filePath: opts?.filePath ?? `.migrations/${id}.migration.yaml`,
    dependsOn: opts?.dependsOn ?? [],
    data: {
      migration: { id, name: id, date: '2026-01-01', status: 'pending', description: 'test' },
      changes,
    },
  };
}
