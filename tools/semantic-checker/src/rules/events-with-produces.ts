import type { BlueprintModel } from '../../../model-builder/dist/model/types.js';
import type { RuleDefinition, SemanticIssue } from '../types.js';

export const eventsWithProduces: RuleDefinition = {
  id: 'events-with-produces',
  name: 'Events With Produces',
  description: 'Events are domain facts and should not produce other operations. Use reacts_to on the consuming command instead.',
  defaultSeverity: 'warn',
  check(model: BlueprintModel): SemanticIssue[] {
    const issues: SemanticIssue[] = [];

    const eventIds = new Set(
      model.entities
        .filter(e => {
          if (e.type !== 'Operation') return false;
          const data = e.data as Record<string, unknown> | undefined;
          return data?.kind === 'event';
        })
        .map(e => e.id),
    );

    for (const relation of model.relations) {
      if (relation.type === 'produces' && eventIds.has(relation.source_entity_id)) {
        const event = model.entities.find(e => e.id === relation.source_entity_id);
        issues.push({
          ruleId: 'events-with-produces',
          severity: 'warn',
          message: `Event "${event?.displayId ?? relation.source_entity_id}" has a produces link. Events should trigger reactions via reacts_to on the consuming command.`,
          entityId: event?.displayId,
          file: event?.fileOrigin,
        });
      }
    }
    return issues;
  },
};
