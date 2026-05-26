import type { BlueprintModel } from '../../model-builder/dist/model/types.js';
import type { RuleDefinition, CheckerConfig, SemanticIssue, Severity } from './types.js';

export function runChecker(
  model: BlueprintModel,
  rules: RuleDefinition[],
  config: CheckerConfig = {},
): SemanticIssue[] {
  const issues: SemanticIssue[] = [];

  for (const rule of rules) {
    const ruleConfig = config.rules?.[rule.id];
    const severity = resolveRuleSeverity(rule, ruleConfig);

    if (severity === 'off') continue;

    const ruleIssues = rule.check(model);

    for (const issue of ruleIssues) {
      issues.push({ ...issue, severity });
    }
  }

  return issues;
}

function resolveRuleSeverity(
  rule: RuleDefinition,
  config?: string | { severity?: string } | undefined,
): Severity | 'off' {
  if (!config) return rule.defaultSeverity;
  if (typeof config === 'string') return config as Severity | 'off';
  return (config.severity as Severity | 'off') ?? rule.defaultSeverity;
}
