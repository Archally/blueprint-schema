import type { Entity } from '../../model-builder/dist/model/types.js';

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

export function entityLabel(entity: Entity): string {
  const name = entity.summary ?? entity.term ?? entity.description?.slice(0, 50);
  if (name) return `${entity.displayId}: ${name}`;
  return entity.displayId;
}

export function escapeMermaid(text: string): string {
  return text.replace(/"/g, "'");
}
