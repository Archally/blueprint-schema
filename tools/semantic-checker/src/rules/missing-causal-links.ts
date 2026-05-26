import type { BlueprintModel } from '../../../model-builder/dist/model/types.js';
import type { RuleDefinition, SemanticIssue } from '../types.js';

export const missingCausalLinks: RuleDefinition = {
  id: 'missing-causal-links',
  name: 'Missing Causal Links',
  description: 'Commands must produce at least one event. Reactive commands must have reacts_to.',
  defaultSeverity: 'warn',
  check(model: BlueprintModel): SemanticIssue[] {
    const issues: SemanticIssue[] = [];

    const producesSource = new Set(
      model.relations
        .filter(r => r.type === 'produces')
        .map(r => r.source_entity_id),
    );

    for (const entity of model.entities) {
      if (entity.type !== 'Operation') continue;
      const data = entity.data as Record<string, unknown> | undefined;
      if (!data) continue;

      const kind = data.kind as string | undefined;
      if (kind !== 'command') continue;

      if (!producesSource.has(entity.id)) {
        issues.push({
          ruleId: 'missing-causal-links',
          severity: 'warn',
          message: `Command "${entity.displayId}" (${entity.term ?? 'unnamed'}) has no produces link to any event.`,
          entityId: entity.displayId,
          file: entity.fileOrigin,
        });
      }
    }

    return issues;
  },
};
