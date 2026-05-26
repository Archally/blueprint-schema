import type { BlueprintModel } from '../../../model-builder/dist/model/types.js';
import type { RuleDefinition, SemanticIssue } from '../types.js';

export const orphanEntities: RuleDefinition = {
  id: 'orphan-entities',
  name: 'Orphan Entities',
  description: 'Entities that are defined but never referenced by any relation (source or target).',
  defaultSeverity: 'warn',
  check(model: BlueprintModel): SemanticIssue[] {
    const referenced = new Set<string>();
    for (const relation of model.relations) {
      referenced.add(relation.source_entity_id);
      referenced.add(relation.target_entity_id);
    }

    const issues: SemanticIssue[] = [];
    for (const entity of model.entities) {
      if (entity.type === 'Missing') continue;
      if (entity.type === 'CodeFile') continue;
      if (!referenced.has(entity.id)) {
        issues.push({
          ruleId: 'orphan-entities',
          severity: 'warn',
          message: `${entity.type} "${entity.displayId}" (${entity.term ?? 'unnamed'}) is never referenced by any other entity.`,
          entityId: entity.displayId,
          file: entity.fileOrigin,
        });
      }
    }
    return issues;
  },
};
