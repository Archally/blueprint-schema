import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * Where a governance statement sticks on the domain model.
 *
 *   Risk     --risk_affects-->     Operation | Concept | Story  (risk.affects.*_refs[])
 *   Inquiry  --inquiry_affects-->  Operation | Concept | Story  (inquiry.affects.*_refs[])
 *   Finding  --finding_affects-->  Operation | Concept | Story  (finding.affects.*_refs[])
 *   Goal     --goal_affects-->     Operation | Concept | Story  (goal.affects.*_refs[])
 *
 * `affects.context_refs[]` is a context PREFIX (`orders`), a name rather than an entity id, so it
 * builds no edge here; the slice it names is the folder the concern's artifacts already land in.
 *
 * Finding carried `affects` from v2.7 and nothing read it: the reference walk checked the ids and
 * no relation was ever built, so a finding about an operation was invisible to every graph query
 * and every drawing. One extractor for the four, so the shape cannot drift between them.
 *
 * A GOAL is the odd one and belongs here anyway. It is not a concern but an intention, and an
 * Event Storming wall draws it as an opportunity rather than a hotspot - yet "where it sticks" is
 * the same question and the same four ref lists answer it, so a second spelling would be a second
 * place for the shape to drift.
 */
const AFFECTS_TYPE: Partial<Record<string, string>> = {
  [ENTITY_TYPE.Risk]: RELATION_TYPE.RiskAffects,
  [ENTITY_TYPE.Inquiry]: RELATION_TYPE.InquiryAffects,
  [ENTITY_TYPE.Finding]: RELATION_TYPE.FindingAffects,
  [ENTITY_TYPE.Goal]: RELATION_TYPE.GoalAffects,
};

const REF_LISTS = ['operation_refs', 'concept_refs', 'story_refs'] as const;

export function extractAffectsRelations(entities: Entity[], placeholders: Map<string, Entity>): Relation[] {
  const relations: Relation[] = [];
  for (const entity of entities) {
    const type = AFFECTS_TYPE[entity.type];
    if (!type) continue;
    const affects = (entity.data as { affects?: Record<string, unknown> } | undefined)?.affects;
    if (!affects || typeof affects !== 'object') continue;
    const domain = entityDomain(entity);
    const seen = new Set<string>();
    for (const list of REF_LISTS) {
      const refs = affects[list];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref !== 'string' || !ref) continue;
        const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
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
