import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE, type RelationType } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Typed relation ref-list fields shared by BOTH milestone and work_item (v2.7.2).
 * roadmap owns the ref direction (roadmap item → target).
 */
const TYPED_RELATION_FIELDS: Array<[string, RelationType]> = [
  ['advances_goals', RELATION_TYPE.RoadmapAdvancesGoal],
  ['mitigates_risks', RELATION_TYPE.RoadmapMitigatesRisk],
  ['realizes_decisions', RELATION_TYPE.RoadmapRealizesDecision],
  ['value_streams', RELATION_TYPE.RoadmapValueStream],
  ['user_stories', RELATION_TYPE.RoadmapUserStory],
  ['use_cases', RELATION_TYPE.RoadmapUseCase],
];

/** Push one relation per resolvable string ref in `value` (a ref-list field). */
function pushListRefs(
  relations: Relation[],
  entity: Entity,
  value: unknown,
  type: RelationType,
  domain: string,
  entities: Entity[],
  placeholders: Map<string, Entity>
): void {
  if (!Array.isArray(value)) return;
  for (const ref of value) {
    if (typeof ref !== 'string' || !ref) continue;
    const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
    relations.push({
      id: `${entity.id}--${type}--${targetId}`,
      source_entity_id: entity.id,
      target_entity_id: targetId,
      type,
    });
  }
}

/**
 * Extract outbound relations from roadmap entities.
 *
 * Milestone (MS###):
 * - dependencies[] → MilestoneDependency (milestone → milestone)
 * - deliverables[].ref → MilestoneDeliverable (milestone → entity, kind predicate)
 *
 * WorkItem (WI###, v2.7.2):
 * - milestone → WorkItemMilestone (work item → milestone/release)
 * - children[].id → WorkItemChild (parent → child, hierarchy)
 * - depends_on[] → WorkItemDependency (work item → work item/milestone)
 * - blockers[].blocked_by[] → WorkItemBlockedBy (work item → work item/milestone/inquiry)
 *
 * Both tiers (v2.7.2): advances_goals / mitigates_risks / realizes_decisions /
 * value_streams / user_stories / use_cases → Roadmap* relations.
 */
export function extractRoadmapRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const isMilestone = entity.type === ENTITY_TYPE.Milestone;
    const isWorkItem = entity.type === ENTITY_TYPE.WorkItem;
    if (!isMilestone && !isWorkItem) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // Typed relations shared by both tiers.
    for (const [field, type] of TYPED_RELATION_FIELDS) {
      pushListRefs(relations, entity, data[field], type, domain, entities, placeholders);
    }

    if (isMilestone) {
      // dependencies[]: milestone refs (MS###)
      pushListRefs(
        relations,
        entity,
        data.dependencies,
        RELATION_TYPE.MilestoneDependency,
        domain,
        entities,
        placeholders
      );

      // deliverables[]: polymorphic refs (kind + ref)
      const deliverables = data.deliverables as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(deliverables)) {
        for (const deliverable of deliverables) {
          if (!deliverable || typeof deliverable !== 'object') continue;
          const ref = deliverable.ref as string | undefined;
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          const kind = deliverable.kind as string | undefined;
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.MilestoneDeliverable}--${kind ?? 'unknown'}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.MilestoneDeliverable,
            predicate: kind,
          });
        }
      }
    }

    if (isWorkItem) {
      // milestone: the release this work item rolls up to (MS###)
      const milestoneRef = data.milestone;
      if (typeof milestoneRef === 'string' && milestoneRef) {
        const targetId = resolveOrPlaceholder(milestoneRef, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.WorkItemMilestone}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.WorkItemMilestone,
        });
      }

      // children[].id: parent → child (hierarchy). Children are flattened into their own entities.
      const children = data.children as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (!child || typeof child !== 'object' || child.id == null) continue;
          const childRef = String(child.id);
          const targetId = resolveOrPlaceholder(childRef, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.WorkItemChild}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.WorkItemChild,
          });
        }
      }

      // depends_on[]: work item / milestone refs
      pushListRefs(
        relations,
        entity,
        data.depends_on,
        RELATION_TYPE.WorkItemDependency,
        domain,
        entities,
        placeholders
      );

      // blockers[]: string | { text, tracker_ref, blocked_by[] }. Only blocked_by[] yields relations.
      const blockers = data.blockers as unknown[] | undefined;
      if (Array.isArray(blockers)) {
        for (const blocker of blockers) {
          if (!blocker || typeof blocker !== 'object') continue;
          pushListRefs(
            relations,
            entity,
            (blocker as Record<string, unknown>).blocked_by,
            RELATION_TYPE.WorkItemBlockedBy,
            domain,
            entities,
            placeholders
          );
        }
      }
    }
  }

  return relations;
}
