import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder, entityDomain, resolveRef } from './resolver.js';
import type { OperationDetail } from '../entities/story.js';

/**
 * Build Story → Operation relations from Story entities' operationsDetail.
 *
 * Resolution uses the shared displayId-based resolver (`resolveRef`) rather than a
 * reconstructed file-based internal id. This is required by the multi-file convention:
 * operations live in `*.domain.yaml` files (e.g. `product-core.domain.yaml`), so the internal
 * id (which bakes in the file basename) cannot be reconstructed from the ref alone. Matching by
 * displayId (e.g. `catalog.CMD001`) resolves the operation regardless of which file holds it.
 *
 * Before 2026-07-25 this matched on the guessed internal id and fabricated a Missing placeholder
 * whenever the guess missed — 57 phantom "missing" operations on the prestashop model, every one of
 * which was present in the model. The public builder had already been fixed; this is that fix
 * ported back. Keep the two in lockstep.
 *
 * When the ref genuinely does not resolve, a Missing placeholder is created and the step is marked
 * resolved: false on the Story.
 *
 * Either way the outcome is written back onto the Story's `operationsDetail[]`, so the field and the
 * edge always name the same entity: `resolvedEntityId` on success, `resolved: false` on failure.
 */
export function buildStoryRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  const storyEntities = entities.filter((e) => e.type === ENTITY_TYPE.Process);

  for (const story of storyEntities) {
    const details = (story.data as { operationsDetail?: OperationDetail[] })?.operationsDetail ?? [];
    const sourceDomain = entityDomain(story);

    for (const op of details) {
      const ref = op.operationRef;
      // Absent ref → informational step (e.g. a narrative activity with no operation). Skip.
      if (!ref) continue;

      let targetId = resolveRef(ref, sourceDomain, entities);

      if (!targetId) {
        const placeholder = createPlaceholder(ref);
        if (!placeholders.has(placeholder.id)) {
          placeholders.set(placeholder.id, placeholder);
        }
        targetId = placeholder.id;

        const opsDetail = (story.data as { operationsDetail?: OperationDetail[] })?.operationsDetail;
        if (opsDetail && opsDetail[op.position] !== undefined) {
          opsDetail[op.position]!.resolved = false;
        }
        // Log warning per step: optional in Node (no console in tests is fine)
        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
          // eslint-disable-next-line no-console
          console.warn(
            `Story operation '${op.name}' (ref: ${ref}) resolved to entity not found in model; created placeholder.`
          );
        }
      } else {
        // The relation and the Story's own `operationsDetail[].resolvedEntityId` name the SAME
        // operation, so they are resolved once, here, by the resolver above. The entity extractor
        // can only guess that id: it runs before the entity list exists, so it reconstructs
        // `{domain}-domain.yaml-{ref}` from the ref alone, which holds only where a scope keeps its
        // operations in a file literally named `domain.yaml`. Under the multi-file convention
        // (`product-core.domain.yaml`, `api.domain.yaml`) the guess names no entity, and a consumer
        // reading the field walks off the graph while the edge beside it is correct. `op` is the
        // element of `story.data.operationsDetail`, so this writes through to the model.
        op.resolvedEntityId = targetId;
      }

      relations.push({
        id: `${story.id}_orders_${targetId}_${op.position}`,
        source_entity_id: story.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.ProcessOrdersOperation,
        predicate: `orders at position ${op.position}`,
        data: { position: op.position, component: op.component },
      });
    }

    relations.push(...buildSubprocessCalls(story, entities));
  }

  return relations;
}

/**
 * `Process --calls_subprocess--> Process`, one edge per activity that names a process to run.
 *
 * The call is declared on the ACTIVITY and the edge joins the two processes, because an activity is
 * not an entity of this graph - it is carried raw on its process. The activity is named on the edge
 * instead, so a reader can say which point of the caller runs the callee.
 *
 * A ref that resolves to nothing draws NO edge and mints no placeholder, unlike the operation refs
 * above. `calls_subprocess` is typed as a `process_ref` in the schema, so the validator's derived
 * reference keys already report a dangling one as a cross-reference error; a `Missing` node here
 * would be the same defect stated twice, once as a finding and once as something that looks like
 * part of the model.
 */
function buildSubprocessCalls(story: Entity, entities: Entity[]): Relation[] {
  const activities = (story.data as { activities?: Array<Record<string, unknown>> })?.activities;
  if (!Array.isArray(activities)) return [];

  const sourceDomain = entityDomain(story);
  const relations: Relation[] = [];

  for (const activity of activities) {
    if (!activity || typeof activity !== 'object') continue;
    const ref = activity.calls_subprocess;
    if (typeof ref !== 'string' || ref.length === 0) continue;

    const targetId = resolveRef(ref, sourceDomain, entities);
    if (!targetId || targetId === story.id) continue;

    const from = typeof activity.id === 'string' ? activity.id : null;
    relations.push({
      id: `${story.id}_calls_${targetId}${from ? `_${from}` : ''}`,
      source_entity_id: story.id,
      target_entity_id: targetId,
      type: RELATION_TYPE.ProcessCallsSubprocess,
      predicate: from ? `calls as a subprocess at ${from}` : 'calls as a subprocess',
      data: from ? { activity: from } : undefined,
    });
  }

  return relations;
}
