import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder, entityDomain, resolveRef, resolveRefDetailed } from './resolver.js';
import type { OperationDetail } from '../entities/story.js';

/**
 * Build Story → Operation relations from Story entities' operationsDetail.
 *
 * Each step's `operationRef` is resolved by the shared resolution function: it names the operation
 * whose declared id is the same string, wherever that operation's file sits and whatever the file is
 * called. A ref that names nothing, or names a string several operations declare, gets a Missing
 * placeholder; an ambiguous one's placeholder lists every operation that declares the string, so the
 * edge never goes to one of them.
 *
 * The outcome is written back onto the step, which makes this pass the only writer of `resolved`
 * and `resolvedEntityId`: `true` and the operation's internal id when the ref resolves, `false` and
 * no id otherwise. The step and the edge therefore always name the same entity.
 */
export function buildStoryRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  const storyEntities = entities.filter((e) => e.type === ENTITY_TYPE.Process);

  for (const story of storyEntities) {
    const details = (story.data as { operationsDetail?: OperationDetail[] })?.operationsDetail ?? [];

    for (const op of details) {
      const ref = op.operationRef;
      // Absent ref → informational step (e.g. a narrative activity with no operation). Skip.
      if (!ref) continue;

      // `op` is the element of `story.data.operationsDetail`, so the writes below reach the model.
      const resolution = resolveRefDetailed(ref, entities);
      let targetId: string;
      if (resolution.status === 'resolved') {
        targetId = resolution.handle;
        op.resolved = true;
        op.resolvedEntityId = targetId;
      } else {
        const placeholder = createPlaceholder(ref, resolution.status === 'ambiguous' ? resolution.handles : undefined);
        if (!placeholders.has(placeholder.id)) {
          placeholders.set(placeholder.id, placeholder);
        }
        targetId = placeholder.id;
        op.resolved = false;
        delete op.resolvedEntityId;
        // Log warning per step: optional in Node (no console in tests is fine)
        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
          // eslint-disable-next-line no-console
          console.warn(
            `Story operation '${op.name}' (ref: ${ref}) resolved to ${resolution.status === 'ambiguous' ? 'several entities' : 'no entity'} in the model; created placeholder.`
          );
        }
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
