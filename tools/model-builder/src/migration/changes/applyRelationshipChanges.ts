/**
 * Apply relationship-level migration changes: add, remove, redirect, modify.
 */
import type { BlueprintModel } from '../../model/types.js';
import { resolveRef } from '../../extraction/relations/resolver.js';
import { MigrationError } from '../migrationError.js';
import { resolveTargetId } from '../migrationApplyUtils.js';

const RELATIONSHIP_PREDICATE_ALIASES: Record<string, string> = {
  precondition: 'preconditions',
  postcondition: 'postconditions',
};

export function normalizeRelationshipPredicate(predicate: string): string {
  return RELATIONSHIP_PREDICATE_ALIASES[predicate] ?? predicate;
}

// ---------------------------------------------------------------------------
// Apply: Relationship changes
// ---------------------------------------------------------------------------

export function applyRelationshipChanges(
  model: BlueprintModel,
  changes: Record<string, unknown>[],
  _migrationFilePath: string | undefined,
): void {
  for (const change of changes) {
    const kind = String(change.kind ?? '');
    const subject = String(change.subject ?? '');
    const predicate = normalizeRelationshipPredicate(String(change.predicate ?? ''));
    const object = String(change.object ?? '');

    switch (kind) {
      case 'add': {
        const sourceId = resolveTargetId(subject, model.entities, `relationship add subject`);
        const targetId = resolveTargetId(object, model.entities, `relationship add object`);
        const edgeProps = change.edge_properties as Record<string, unknown> | undefined;
        const relationId = `${sourceId}--${predicate}--${targetId}`;
        if (model.relations.some((r) => r.id === relationId)) {
          throw new MigrationError(`Duplicate edge on add: ${subject} --${predicate}--> ${object}`);
        }
        model.relations.push({
          id: relationId,
          source_entity_id: sourceId,
          target_entity_id: targetId,
          type: predicate,
          predicate,
          data: edgeProps,
        });
        break;
      }
      case 'remove': {
        const sourceId = resolveRef(subject, 'default', model.entities);
        const targetId = resolveRef(object, 'default', model.entities);
        if (!sourceId || !targetId) break;
        const exists = model.relations.some(
          (r) =>
            r.source_entity_id === sourceId &&
            r.target_entity_id === targetId &&
            (r.type === predicate || r.predicate === predicate),
        );
        if (!exists) {
          throw new MigrationError(`remove targets non-existent edge: ${subject} --${predicate}--> ${object}`);
        }
        model.relations = model.relations.filter(
          (r) =>
            !(r.source_entity_id === sourceId &&
              r.target_entity_id === targetId &&
              (r.type === predicate || r.predicate === predicate)),
        );
        break;
      }
      case 'redirect': {
        const newObject = String(change.new_object ?? '');
        if (!newObject) throw new MigrationError(`Relationship redirect: missing new_object`);
        const sourceId = resolveRef(subject, 'default', model.entities);
        const oldTargetId = resolveRef(object, 'default', model.entities);
        const newTargetId = resolveTargetId(newObject, model.entities, 'relationship redirect new_object');
        if (!sourceId || !oldTargetId) break;
        const matching = model.relations.filter(
          (r) =>
            r.source_entity_id === sourceId &&
            r.target_entity_id === oldTargetId &&
            (r.type === predicate || r.predicate === predicate),
        );
        if (matching.length === 0) {
          throw new MigrationError(`redirect targets non-existent edge: ${subject} --${predicate}--> ${object}`);
        }
        for (const r of matching) {
          r.target_entity_id = newTargetId;
          r.id = `${sourceId}--${predicate}--${newTargetId}`;
        }
        break;
      }
      case 'modify': {
        const sourceId = resolveRef(subject, 'default', model.entities);
        const targetId = resolveRef(object, 'default', model.entities);
        const edgeProps = change.edge_properties as Record<string, unknown> | undefined;
        if (sourceId && targetId && edgeProps) {
          for (const r of model.relations) {
            if (
              r.source_entity_id === sourceId &&
              r.target_entity_id === targetId &&
              (r.type === predicate || r.predicate === predicate)
            ) {
              r.data = { ...(r.data ?? {}), ...edgeProps };
            }
          }
        }
        break;
      }
      default:
        throw new MigrationError(`Unknown relationship change kind: ${kind}`);
    }
  }
}
