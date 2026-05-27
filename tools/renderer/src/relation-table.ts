import type { Entity, Relation } from '../../model-builder/dist/model/types.js';

export function renderRelationTable(relations: Relation[], entities: Entity[]): string {
  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));

  const lines: string[] = ['## Relations', ''];
  lines.push(`**${relations.length} relations** discovered.`, '');
  lines.push('| Source | Type | Target |');
  lines.push('|--------|------|--------|');

  const sorted = [...relations].sort((a, b) => a.type.localeCompare(b.type));
  for (const relation of sorted) {
    const source = entityMap.get(relation.source_entity_id);
    const target = entityMap.get(relation.target_entity_id);
    const sourceLabel = source ? `${source.displayId} (${source.type})` : relation.source_entity_id;
    const targetLabel = target ? `${target.displayId} (${target.type})` : relation.target_entity_id;
    lines.push(`| ${sourceLabel} | ${relation.type} | ${targetLabel} |`);
  }

  lines.push('');

  const byType = new Map<string, number>();
  for (const relation of relations) {
    byType.set(relation.type, (byType.get(relation.type) ?? 0) + 1);
  }
  lines.push('### By Type', '');
  lines.push('| Relation Type | Count |');
  lines.push('|---------------|-------|');
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push('');

  return lines.join('\n');
}
