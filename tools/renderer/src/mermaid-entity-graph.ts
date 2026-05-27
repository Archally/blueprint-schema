import type { Entity, Relation } from '../../model-builder/dist/model/types.js';
import { sanitizeId, entityLabel, escapeMermaid } from './mermaid-utils.js';

export function renderEntityGraph(entities: Entity[], relations: Relation[]): string {
  if (entities.length === 0) return '';

  const lines: string[] = ['## Entity Graph', '', '```mermaid', 'graph TD'];

  const layerGroups = new Map<string, Entity[]>();
  for (const entity of entities) {
    const list = layerGroups.get(entity.layer) ?? [];
    list.push(entity);
    layerGroups.set(entity.layer, list);
  }

  for (const [layer, group] of layerGroups) {
    lines.push(`    subgraph ${sanitizeId(layer)}["${layer}"]`);
    for (const entity of group) {
      const label = escapeMermaid(entityLabel(entity));
      lines.push(`        ${sanitizeId(entity.displayId)}["${label}"]`);
    }
    lines.push('    end');
  }

  for (const relation of relations) {
    const source = entities.find((entity) => entity.id === relation.source_entity_id);
    const target = entities.find((entity) => entity.id === relation.target_entity_id);
    if (source && target) {
      lines.push(`    ${sanitizeId(source.displayId)} -.->|"${relation.type}"| ${sanitizeId(target.displayId)}`);
    }
  }

  lines.push('```', '');
  return lines.join('\n');
}
