import type { Entity, Relation, ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { entityDomain, resolveOrPlaceholder, createPlaceholder } from './resolver.js';

/**
 * Extract outbound relations from motivation entities (v2.5 enrichments):
 * - risk.owner      → RiskOwner      (risk → actor or team)
 * - risk.goal_refs[] → RiskGoal      (risk → goal)
 * - assumption.risk_refs[] → AssumptionRisk (assumption → risk)
 * - goal.kpi        → GoalKpi       (goal → KPI)
 * - goal.assumption_refs[] → GoalAssumption (goal → assumption it rests on)
 *
 * `goal.kpi` and `kpi.goal` are the same join written from either side; the KPI's own field is
 * extracted with the quality plane, and the two stay distinct edges because which side stated the
 * link is part of what the model says.
 */
export function extractMotivationRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>,
  documents: ParsedBlueprintDocument[] = []
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const domain = entityDomain(entity);
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    if (entity.type === ENTITY_TYPE.Risk) {
      // v2.5: owner — individual responsible for risk response
      const owner = data.owner as string | undefined;
      if (typeof owner === 'string' && owner) {
        const targetId = resolveOrPlaceholder(owner, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.RiskOwner}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.RiskOwner,
        });
      }

      // v2.5: goal_refs[] — goals this risk threatens
      const goalRefs = data.goal_refs as string[] | undefined;
      if (Array.isArray(goalRefs)) {
        for (const ref of goalRefs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.RiskGoal}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.RiskGoal,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.Goal) {
      const assertions = data.goal_relations;
      if (Array.isArray(assertions)) {
        const kinds: Record<string, string> = {
          contributes_to: RELATION_TYPE.GoalContributesTo,
          requires: RELATION_TYPE.GoalRequires,
          conflicts_with: RELATION_TYPE.GoalConflictsWith,
        };
        assertions.forEach((assertion, occurrence) => {
          if (!assertion || typeof assertion !== 'object') return;
          const type = Object.hasOwn(kinds, assertion.kind) ? kinds[assertion.kind] : undefined;
          if (!type || typeof assertion.target_goal !== 'string') return;
          // Count declarations, including duplicate declarations sharing an internal id.
          const candidates = entities.filter(candidate => candidate.type !== ENTITY_TYPE.Missing
            && candidate.displayId === assertion.target_goal);
          const target = candidates.length === 1 ? candidates[0] : undefined;
          const resolution = candidates.length > 1 ? 'ambiguous' : 'unresolved';
          let targetId: string;
          if (target?.type === ENTITY_TYPE.Goal) {
            targetId = target.id;
          } else {
            const placeholder = createPlaceholder(assertion.target_goal,
              resolution === 'ambiguous' ? candidates.map(candidate => candidate.id) : undefined);
            // A typed goal target resolving to a non-Goal stays diagnostic in the raw graph.
            placeholder.id = `missing-goal-${encodeURIComponent(assertion.target_goal)}`;
            placeholder.data = { ...placeholder.data, expectedType: ENTITY_TYPE.Goal,
              resolution: target ? 'wrong-type' : resolution };
            placeholders.set(placeholder.id, placeholder);
            targetId = placeholder.id;
          }
          const documentGoals = entities.filter(candidate => candidate.type === ENTITY_TYPE.Goal
            && candidate.fileOrigin === entity.fileOrigin);
          const position = documentGoals.indexOf(entity);
          const rawGoals = documents.find(document => document.filePath === entity.fileOrigin)?.data.goals;
          const authoredIndexes = Array.isArray(rawGoals)
            ? rawGoals.flatMap((goal, index) => goal && typeof goal === 'object' && goal.id != null ? [index] : [])
            : undefined;
          const goalIndex = authoredIndexes?.[position] ?? position;
          relations.push({
            id: `${entity.id}--${type}--${assertion.contribution ?? 'none'}--${targetId}--${occurrence}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type,
            data: { ...assertion, source_path: {
              file: entity.fileOrigin ?? '',
              path: ['goals', goalIndex, 'goal_relations', occurrence],
            } },
          });
        });
      }

      // kpi - the indicator this goal is tracked by
      const kpi = data.kpi as string | undefined;
      if (typeof kpi === 'string' && kpi) {
        const targetId = resolveOrPlaceholder(kpi, domain, entities, placeholders);
        relations.push({
          id: `${entity.id}--${RELATION_TYPE.GoalKpi}--${targetId}`,
          source_entity_id: entity.id,
          target_entity_id: targetId,
          type: RELATION_TYPE.GoalKpi,
        });
      }

      // v2.8.64: assumption_refs[] - the assumptions this goal rests on
      const assumptionRefs = data.assumption_refs as string[] | undefined;
      if (Array.isArray(assumptionRefs)) {
        for (const ref of assumptionRefs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.GoalAssumption}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.GoalAssumption,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.Assumption) {
      // v2.5: risk_refs[] — risks invalidated if assumption is wrong
      const riskRefs = data.risk_refs as string[] | undefined;
      if (Array.isArray(riskRefs)) {
        for (const ref of riskRefs) {
          if (typeof ref !== 'string' || !ref) continue;
          const targetId = resolveOrPlaceholder(ref, domain, entities, placeholders);
          relations.push({
            id: `${entity.id}--${RELATION_TYPE.AssumptionRisk}--${targetId}`,
            source_entity_id: entity.id,
            target_entity_id: targetId,
            type: RELATION_TYPE.AssumptionRisk,
          });
        }
      }
    }

    if (entity.type === ENTITY_TYPE.Vision) {
      // v2.7.7 (D045): the vision's forward-links — identity → objectives → competencies → delivery.
      const visionRefFields: { field: string; type: string }[] = [
        { field: 'advances_goals', type: RELATION_TYPE.VisionAdvancesGoal },
        { field: 'capability_refs', type: RELATION_TYPE.VisionCapability },
        { field: 'value_stream_refs', type: RELATION_TYPE.VisionValueStream },
      ];
      for (const { field, type } of visionRefFields) {
        const refs = data[field] as string[] | undefined;
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
  }

  return relations;
}
