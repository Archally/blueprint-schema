import type { Entity } from '../../model-builder/dist/model/types.js';

export function renderEntityCatalog(entities: Entity[]): string {
  const byType = new Map<string, Entity[]>();
  for (const entity of entities) {
    const list = byType.get(entity.type) ?? [];
    list.push(entity);
    byType.set(entity.type, list);
  }

  const lines: string[] = ['## Entity Catalog', ''];
  lines.push(`**${entities.length} entities** across ${byType.size} types.`, '');
  lines.push('| ID | Type | Name | Layer | Source |');
  lines.push('|----|------|------|-------|--------|');

  const sorted = [...entities].sort((a, b) => a.type.localeCompare(b.type) || a.displayId.localeCompare(b.displayId));
  for (const entity of sorted) {
    const name = entity.summary ?? entity.term ?? entity.description?.slice(0, 60) ?? '';
    const source = entity.fileOrigin ?? '';
    lines.push(`| ${entity.displayId} | ${entity.type} | ${name} | ${entity.layer} | ${source} |`);
  }

  lines.push('');

  lines.push('### By Type', '');
  lines.push('| Type | Count |');
  lines.push('|------|-------|');
  const typeCounts = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [type, list] of typeCounts) {
    lines.push(`| ${type} | ${list.length} |`);
  }
  lines.push('');

  return lines.join('\n');
}
