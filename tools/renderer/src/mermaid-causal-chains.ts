import type { Entity, Relation } from '../../model-builder/dist/model/types.js';

export function renderCausalChains(entities: Entity[], relations: Relation[]): string {
  const causalTypes = new Set(['produces', 'reacts_to', 'initiated_by', 'triggers', 'emits', 'consumes']);
  const causalRelations = relations.filter((relation) => causalTypes.has(relation.type));
  if (causalRelations.length === 0) return '';

  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
  const involvedIds = new Set<string>();
  for (const relation of causalRelations) {
    involvedIds.add(relation.source_entity_id);
    involvedIds.add(relation.target_entity_id);
  }

  const lines: string[] = ['## Causal Chains', '', '```mermaid', 'graph LR'];

  for (const id of involvedIds) {
    const entity = entityMap.get(id);
    if (!entity) continue;
    const label = entity.summary ?? entity.displayId;
    const shape = getShape(entity.type);
    lines.push(`    ${sanitizeId(entity.displayId)}${shape[0]}"${label}"${shape[1]}`);
  }

  for (const relation of causalRelations) {
    const source = entityMap.get(relation.source_entity_id);
    const target = entityMap.get(relation.target_entity_id);
    if (source && target) {
      const label = relation.type.replace(/_/g, ' ');
      lines.push(`    ${sanitizeId(source.displayId)} -->|"${label}"| ${sanitizeId(target.displayId)}`);
    }
  }

  lines.push('```', '');
  return lines.join('\n');
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function getShape(type: string): [string, string] {
  switch (type) {
    case 'Command': return ['{{', '}}'];
    case 'Event': return ['([', '])'];
    case 'Query': return ['([', '])'];
    default: return ['[', ']'];
  }
}
