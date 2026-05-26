import type { BlueprintModel } from '../../../model-builder/dist/model/types.js';
import type { RuleDefinition, SemanticIssue } from '../types.js';

export const unansweredQuestions: RuleDefinition = {
  id: 'unanswered-questions',
  name: 'Unanswered Questions',
  description: 'Domain questions with empty answered_by represent knowledge gaps. Surfaced as info for backlog prioritization.',
  defaultSeverity: 'info',
  check(model: BlueprintModel): SemanticIssue[] {
    const issues: SemanticIssue[] = [];

    const answeredQuestionIds = new Set(
      model.relations
        .filter(r => r.type === 'question_answered_by')
        .map(r => r.source_entity_id),
    );

    for (const entity of model.entities) {
      if (entity.type !== 'Question') continue;
      if (!answeredQuestionIds.has(entity.id)) {
        issues.push({
          ruleId: 'unanswered-questions',
          severity: 'info',
          message: `Question "${entity.displayId}" (${entity.term ?? 'unnamed'}) has no operation answering it — domain gap.`,
          entityId: entity.displayId,
          file: entity.fileOrigin,
        });
      }
    }
    return issues;
  },
};
