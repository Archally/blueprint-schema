import type { BlueprintModel } from '../../../model-builder/dist/model/types.js';
import type { RuleDefinition, SemanticIssue } from '../types.js';

const RULE_TYPES = new Set([
  'StructuralRule', 'ClassificationRule', 'DerivationRule',
  'EquivalenceRule', 'ValidationRule', 'TransitionRule',
]);

export const untestedRules: RuleDefinition = {
  id: 'untested-rules',
  name: 'Untested Rules',
  description: 'Every business rule should be validated by at least one test case.',
  defaultSeverity: 'warn',
  check(model: BlueprintModel): SemanticIssue[] {
    const testedRuleIds = new Set<string>();
    for (const relation of model.relations) {
      if (relation.type === 'validates') {
        testedRuleIds.add(relation.target_entity_id);
      }
    }

    const issues: SemanticIssue[] = [];
    for (const entity of model.entities) {
      if (!RULE_TYPES.has(entity.type)) continue;
      if (!testedRuleIds.has(entity.id)) {
        issues.push({
          ruleId: 'untested-rules',
          severity: 'warn',
          message: `Rule "${entity.displayId}" (${entity.term ?? 'unnamed'}) has no test case validating it.`,
          entityId: entity.displayId,
          file: entity.fileOrigin,
        });
      }
    }
    return issues;
  },
};
