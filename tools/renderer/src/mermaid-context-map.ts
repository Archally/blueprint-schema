import type { Entity, Relation } from '../../model-builder/dist/model/types.js';
import { sanitizeId, entityLabel, escapeMermaid } from './mermaid-utils.js';

export function renderContextMap(entities: Entity[], relations: Relation[]): string {
  const contexts = entities.filter((entity) => entity.type === 'BoundedContext' || entity.type === 'Context');
  if (contexts.length === 0) return '';

  const contextIds = new Set(contexts.map((context) => context.id));
  const contextRelations = relations.filter(
    (relation) => contextIds.has(relation.source_entity_id) && contextIds.has(relation.target_entity_id),
  );

  const lines: string[] = ['## Context Map', '', '```mermaid', 'graph LR'];

  for (const context of contexts) {
    const label = escapeMermaid(entityLabel(context));
    lines.push(`    ${sanitizeId(context.displayId)}["${label}"]`);
  }

  for (const relation of contextRelations) {
    const source = entities.find((entity) => entity.id === relation.source_entity_id);
    const target = entities.find((entity) => entity.id === relation.target_entity_id);
    if (source && target) {
      const label = relation.type.replace(/_/g, ' ');
      lines.push(`    ${sanitizeId(source.displayId)} -->|"${label}"| ${sanitizeId(target.displayId)}`);
    }
  }

  lines.push('```', '');
  return lines.join('\n');
}
