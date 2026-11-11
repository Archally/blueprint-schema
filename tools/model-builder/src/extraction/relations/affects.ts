import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder, entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Where a governance statement sticks on the domain model.
 *
 *   Risk       --risk_affects-->       Operation | Concept | Process | BoundedContext | Service | Package | Capability
 *   Inquiry    --inquiry_affects-->    Operation | Concept | Process | BoundedContext | Service | Package | Capability
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
          data: { activity: reference },
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
  }
  return relations;
}
