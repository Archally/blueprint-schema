import type { BlueprintModel } from '../../../model-builder/dist/model/types.js';
import type { RuleDefinition, SemanticIssue } from '../types.js';

export const aggregateRootSignals: RuleDefinition = {
  id: 'aggregate-root-signals',
  name: 'Aggregate Root Signals',
  description: 'Concepts with stereotype aggregate-root should have states, contains relationships, or governed-by rules.',
  defaultSeverity: 'info',
  check(model: BlueprintModel): SemanticIssue[] {
    const issues: SemanticIssue[] = [];

    const hasRelationFrom = new Set(
      model.relations.map(r => r.source_entity_id),
    );
    const hasRelationTo = new Set(
      model.relations.map(r => r.target_entity_id),
    );

    for (const entity of model.entities) {
      if (entity.type !== 'Concept') continue;
      const data = entity.data as Record<string, unknown> | undefined;
      if (!data) continue;
      if (data.stereotype !== 'aggregate-root') continue;

      const hasStates = Array.isArray(data.states) && data.states.length > 0;
      const hasRelations = hasRelationFrom.has(entity.id) || hasRelationTo.has(entity.id);

      if (!hasStates && !hasRelations) {
        issues.push({
          ruleId: 'aggregate-root-signals',
          severity: 'info',
          message: `Aggregate root "${entity.displayId}" (${entity.term ?? 'unnamed'}) has no states, no relationships, and no governance links. Consider adding lifecycle states or connecting to rules/operations.`,
          entityId: entity.displayId,
          file: entity.fileOrigin,
        });
      }
    }

    return issues;
  },
};
