import type { Entity, Relation } from '../../model-builder/dist/model/types.js';

export function renderCoverageGaps(entities: Entity[], relations: Relation[]): string {
  const lines: string[] = ['## Coverage Gaps', ''];

  const relationTargets = new Set(relations.map((relation) => relation.target_entity_id));
  const relationSources = new Set(relations.map((relation) => relation.source_entity_id));
  const connected = new Set([...relationTargets, ...relationSources]);

  const orphans = entities.filter((entity) => !connected.has(entity.id));
  if (orphans.length > 0) {
    lines.push(`### Orphan Entities (${orphans.length})`, '');
    lines.push('Entities with no incoming or outgoing relations:', '');
    for (const entity of orphans) {
      lines.push(`- **${entity.displayId}** (${entity.type}) — ${entity.summary ?? entity.term ?? 'no description'}`);
    }
    lines.push('');
  }

  const commands = entities.filter((entity) => entity.type === 'Command');
  const events = entities.filter((entity) => entity.type === 'Event');
  const producesRelations = relations.filter((relation) => relation.type === 'produces');
  const producedEventIds = new Set(producesRelations.map((relation) => relation.target_entity_id));
  const producingCommandIds = new Set(producesRelations.map((relation) => relation.source_entity_id));

  const commandsWithoutEvents = commands.filter((command) => !producingCommandIds.has(command.id));
  const eventsWithoutSource = events.filter((event) => !producedEventIds.has(event.id));

  if (commandsWithoutEvents.length > 0) {
    lines.push(`### Commands Without Events (${commandsWithoutEvents.length})`, '');
    for (const command of commandsWithoutEvents) {
      lines.push(`- **${command.displayId}** — ${command.summary ?? 'no description'}`);
    }
    lines.push('');
  }

  if (eventsWithoutSource.length > 0) {
    lines.push(`### Events Without Source Command (${eventsWithoutSource.length})`, '');
    for (const event of eventsWithoutSource) {
      lines.push(`- **${event.displayId}** — ${event.summary ?? 'no description'}`);
    }
    lines.push('');
  }

  const rules = entities.filter((entity) => entity.type === 'Rule' || entity.type === 'TransitionRule');
  const testedRuleIds = new Set(
    relations.filter((relation) => relation.type === 'validates' || relation.type === 'example_validates').map((relation) => relation.target_entity_id),
  );
  const untestedRules = rules.filter((rule) => !testedRuleIds.has(rule.id));
  if (untestedRules.length > 0) {
    lines.push(`### Untested Rules (${untestedRules.length})`, '');
    for (const rule of untestedRules) {
      lines.push(`- **${rule.displayId}** — ${rule.summary ?? 'no description'}`);
    }
    lines.push('');
  }

  if (orphans.length === 0 && commandsWithoutEvents.length === 0 && eventsWithoutSource.length === 0 && untestedRules.length === 0) {
    lines.push('No coverage gaps found.', '');
  }

  return lines.join('\n');
}
