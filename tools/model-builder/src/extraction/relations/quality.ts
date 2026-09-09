import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE, type RelationType } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder } from './resolver.js';

/**
 * The quality plane's outbound references.
 *
 *   Metric      --metric_measures-->      Operation | Concept  (measures.operations[] / .concepts[])
 *   KPI         --kpi_metric-->           Metric               (metric)
 *   KPI         --kpi_goal-->             Goal                 (goal)
 *   KPI         --kpi_owner-->            Actor                (owner)
 *   SLO         --slo_metric-->           Metric               (metric)
 *   SLO         --slo_operation-->        Operation            (operations[])
 *   SLO         --slo_resource-->         InfraResource        (resource_refs[])
 *   SLA         --sla_slo-->              SLO                  (slos[])
 *   Security    --security_operation-->   Operation            (operations[])
 *   Security    --security_concept-->     Concept              (concepts[])
 *   Compliance  --compliance_concept-->   Concept              (concepts[])
 *   Resilience  --resilience_resource-->  InfraResource        (resource_refs[])
 *
 * Together these are the measurement chain the quality schema names - goal -> KPI -> metric ->
 * operation/concept -> SLO -> SLA - plus the three requirement planes that bind to what they
 * govern. The chain's first hop has two authored forms: `kpi.goal` is extracted here, and
 * `goal.kpi` with the rest of the motivation plane.
 *
 * Two fields on these entities deliberately build no edge. `kpi.bounded_context_ref` names a
 * bounded context and is extracted with the other context associations. `sla.parties.provider` and
 * `sla.parties.consumer` hold a name rather than a reference, and a name resolves to nothing.
 *
 * Unresolvable refs degrade to Missing placeholders, as in every other relation extractor.
 */

interface QualityRefField {
  /** Path from the entity's own data to the ref value, dotted for a nested field. */
  path: string;
  type: RelationType;
  /** Whether the field holds a list of refs rather than a single one. */
  list: boolean;
}

const QUALITY_REF_FIELDS: Partial<Record<string, QualityRefField[]>> = {
  [ENTITY_TYPE.Metric]: [
    { path: 'measures.operations', type: RELATION_TYPE.MetricMeasures, list: true },
    { path: 'measures.concepts', type: RELATION_TYPE.MetricMeasures, list: true },
  ],
  [ENTITY_TYPE.KPI]: [
    { path: 'metric', type: RELATION_TYPE.KpiMetric, list: false },
    { path: 'goal', type: RELATION_TYPE.KpiGoal, list: false },
    { path: 'owner', type: RELATION_TYPE.KpiOwner, list: false },
  ],
  [ENTITY_TYPE.SLO]: [
    { path: 'metric', type: RELATION_TYPE.SloMetric, list: false },
    { path: 'operations', type: RELATION_TYPE.SloOperation, list: true },
    { path: 'resource_refs', type: RELATION_TYPE.SloResource, list: true },
  ],
  [ENTITY_TYPE.SLA]: [{ path: 'slos', type: RELATION_TYPE.SlaSlo, list: true }],
  [ENTITY_TYPE.Security]: [
    { path: 'operations', type: RELATION_TYPE.SecurityOperation, list: true },
    { path: 'concepts', type: RELATION_TYPE.SecurityConcept, list: true },
  ],
  [ENTITY_TYPE.Compliance]: [
    { path: 'concepts', type: RELATION_TYPE.ComplianceConcept, list: true },
  ],
  [ENTITY_TYPE.Resilience]: [
    { path: 'resource_refs', type: RELATION_TYPE.ResilienceResource, list: true },
  ],
};

/** Read a dotted path out of an entity's data, returning undefined at the first missing segment. */
function readPath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function extractQualityRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const fields = QUALITY_REF_FIELDS[entity.type];
    if (!fields) continue;

    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    for (const { path, type, list } of fields) {
      const value = readPath(data, path);
      const refs = list ? value : [value];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
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
  }

  return relations;
}
