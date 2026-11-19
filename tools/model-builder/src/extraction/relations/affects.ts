import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder, entityDomain, resolveElementRef, resolveOrPlaceholder } from './resolver.js';

/**
 * Where a governance statement sticks on the domain model.
 *
 *   Risk       --risk_affects-->       Operation | Concept | Process | BoundedContext | Service | Package | Capability
 *   Inquiry    --inquiry_affects-->    Operation | Concept | Process | BoundedContext | Service | Package | Capability,
 *                                       and through element_refs any entity, or the container of a part
 *   Finding    --finding_affects-->    Operation | Concept | Process | BoundedContext | Service | Package
 *   Goal       --goal_affects-->       Operation | Concept | Process | BoundedContext | Service | Package
 *   Assumption --assumption_affects--> Operation | Concept | Process | BoundedContext | Service | Package
 *
 * `affects.context_refs[]` is a context PREFIX (`orders`), a name rather than an entity id, so it
 * builds no edge here; the slice it names is the folder the concern's artifacts already land in.
 *
 * Finding carried `affects` from v2.7 and nothing read it: the reference walk checked the ids and
 * no relation was ever built, so a finding about an operation was invisible to every graph query
 * and every drawing. One extractor for all of them, so the shape cannot drift between them.
 *
 * A GOAL is the odd one and belongs here anyway. It is not a concern but an intention, and an
 * Event Storming wall draws it as an opportunity rather than a hotspot - yet "where it sticks" is
 * the same question and the same four ref lists answer it, so a second spelling would be a second
 * place for the shape to drift.
 *
 * An ASSUMPTION carries `affects` from v2.8 for the same reason: it names the operation, concept or
 * process that depends on it holding, which is where a board pins it.
 *
 * An INQUIRY also names any typed id in `affects.element_refs`: an entity of any type, drawn as an
 * edge to it, or a part of one (a process activity, a concept attribute), drawn as an edge to its
 * container with `data.part` saying which part. A process activity named in
 * `process_activity_refs` is the same pin, with the same edge id and `data.activity`, so one
 * question pinned twice is one edge. An id an inquiry names in a kind list as well is drawn once,
 * from the kind list; the inquiry's own id draws nothing.
 */
const AFFECTS_TYPE: Partial<Record<string, string>> = {
  [ENTITY_TYPE.Risk]: RELATION_TYPE.RiskAffects,
  [ENTITY_TYPE.Inquiry]: RELATION_TYPE.InquiryAffects,
  [ENTITY_TYPE.Finding]: RELATION_TYPE.FindingAffects,
  [ENTITY_TYPE.Goal]: RELATION_TYPE.GoalAffects,
  [ENTITY_TYPE.Assumption]: RELATION_TYPE.AssumptionAffects,
};

// `context_refs` remains a name/prefix; bounded_context_refs is the typed BC id list.
// `story_refs` is retained for models written before `process_refs` became canonical.
// `package_refs` (v2.8.84) names third-party packages; like `capability_refs` it resolves against its
// own type only, so a ref that names no package is a placeholder rather than an edge to whatever
// else declares the string.
const REF_LISTS = ['operation_refs', 'concept_refs', 'process_refs', 'story_refs', 'bounded_context_refs', 'service_refs', 'package_refs'] as const;

/** The identity of a pinned part, as an `inquiry_affects` edge carries it. */
export interface AffectsPart {
  id: string;
  kind: 'process_activity' | 'concept_attribute';
}

/** The kind lists an `element_refs` id is checked against before it draws an edge of its own. */
const KIND_LISTS = [...REF_LISTS, 'capability_refs', 'process_activity_refs'] as const;

export function extractAffectsRelations(entities: Entity[], placeholders: Map<string, Entity>): Relation[] {
  const relations: Relation[] = [];
  // Invalid raw models still retain missing/ambiguous pins, without resolving to a wrong type.
  const capabilities = entities.filter(entity => entity.type === ENTITY_TYPE.Capability
    && /^([a-z][a-z0-9-]*\.)?CAP\d{3}$/.test(entity.displayId));
  const packages = entities.filter(entity => entity.type === ENTITY_TYPE.Package);
  const candidatesFor = (list: string): Entity[] => {
    if (list === 'capability_refs') return capabilities;
    if (list === 'package_refs') return packages;
    return entities;
  };
  for (const entity of entities) {
    const type = AFFECTS_TYPE[entity.type];
    if (!type) continue;
    const affects = (entity.data as { affects?: Record<string, unknown> } | undefined)?.affects;
    if (!affects || typeof affects !== 'object') continue;
    if (entity.type === ENTITY_TYPE.Inquiry && Array.isArray(affects.process_activity_refs)) {
      for (const reference of new Set(affects.process_activity_refs)) {
        if (typeof reference !== 'string' || !reference) continue;
        const matches = entities.flatMap(process => {
          if (process.type !== ENTITY_TYPE.Process) return [];
          const activities = (process.data as { activities?: Array<{ id?: unknown }> } | undefined)?.activities;
          return (Array.isArray(activities) ? activities : []).filter(activity => activity?.id === reference).map(() => process);
        });
        let targetId: string;
        if (matches.length === 1) {
          targetId = matches[0]!.id;
        } else {
          const placeholder = createPlaceholder(reference, matches.length > 1 ? matches.map(process => process.id) : undefined);
          placeholders.set(placeholder.id, placeholder);
          targetId = placeholder.id;
        }
        relations.push({
          id: `${entity.id}--${type}--activity-${reference}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type,
          data: { activity: reference, part: { id: reference, kind: 'process_activity' } satisfies AffectsPart },
        });
      }
    }
    const domain = entityDomain(entity);
    const seen = new Set<string>();
    const lists: readonly string[] = entity.type === ENTITY_TYPE.Risk || entity.type === ENTITY_TYPE.Inquiry
      ? [...REF_LISTS, 'capability_refs'] : REF_LISTS;
    for (const list of lists) {
      const refs = affects[list];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, candidatesFor(list), placeholders);
        if (seen.has(targetId)) continue;
        seen.add(targetId);
        relations.push({
          id: `${entity.id}--${type}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type,
        });
      }
    }
    if (entity.type === ENTITY_TYPE.Inquiry && Array.isArray(affects.element_refs)) {
      relations.push(...elementPins(entity, type, affects, entities, placeholders, seen));
    }
  }
  return relations;
}

/**
 * The edges `affects.element_refs` draws for one inquiry. `seen` holds the targets its kind lists
 * already drew; an id one of those lists names, or the inquiry's own id, draws nothing here.
 */
function elementPins(
  inquiry: Entity,
  type: string,
  affects: Record<string, unknown>,
  entities: Entity[],
  placeholders: Map<string, Entity>,
  seen: Set<string>,
): Relation[] {
  const relations: Relation[] = [];
  const namedInKindLists = new Set(KIND_LISTS.flatMap((list) => (Array.isArray(affects[list]) ? affects[list] as unknown[] : [])));
  const ownIds = new Set([inquiry.displayId, (inquiry.data as { id?: unknown } | undefined)?.id]);
  const drawn = new Set<string>();
  for (const reference of affects.element_refs as unknown[]) {
    if (typeof reference !== 'string' || !reference) continue;
    if (namedInKindLists.has(reference) || ownIds.has(reference)) continue;
    const resolution = resolveElementRef(reference, entities);
    if (resolution.status === 'resolved' && resolution.part) {
      const target = resolution.entity.id;
      const part: AffectsPart = { id: reference, kind: resolution.part.kind };
      const edgeId = part.kind === 'process_activity'
        ? `${inquiry.id}--${type}--activity-${reference}--${target}`
        : `${inquiry.id}--${type}--part-${reference}--${target}`;
      if (drawn.has(edgeId)) continue;
      drawn.add(edgeId);
      relations.push({
        id: edgeId,
        source_entity_id: inquiry.id,
        target_entity_id: target,
        type,
        data: part.kind === 'process_activity' ? { activity: reference, part } : { part },
      });
      continue;
    }
    let target: string;
    if (resolution.status === 'resolved') {
      target = resolution.entity.id;
    } else {
      const placeholder = createPlaceholder(reference, resolution.status === 'ambiguous' ? resolution.candidates : undefined);
      if (!placeholders.has(placeholder.id)) placeholders.set(placeholder.id, placeholder);
      target = placeholder.id;
    }
    if (seen.has(target)) continue;
    seen.add(target);
    relations.push({ id: `${inquiry.id}--${type}--${target}`, source_entity_id: inquiry.id, target_entity_id: target, type });
  }
  return relations;
}
