import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Extract CodeFile entities and code_ref relations from all entities that have code_refs.
 *
 * For each unique code path across all entities, a synthetic CodeFile entity is created.
 * Relations link the blueprint entity to the CodeFile entity with role/line metadata.
 *
 * CodeFile entities are hidden by default in the viewer (toggled via toolbar).
 */
export function extractCodeRefRelations(
  entities: Entity[]
): { relations: Relation[]; codeFileEntities: Entity[] } {
  const relations: Relation[] = [];
  const codeFileMap = new Map<string, Entity>();

  for (const entity of entities) {
    const data = entity.data as Record<string, unknown> | undefined;
    if (!data) continue;

    const codeRefs = data.code_refs as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(codeRefs)) continue;

    // Derive the source entity's domain so CodeFile nodes cluster with it.
    // Use displayId prefix (e.g. "content.CN001" → "content") or fileOrigin first segment.
    const sourceDomain = deriveEntityDomain(entity);

    for (const ref of codeRefs) {
      if (!ref || typeof ref !== 'object') continue;
      const filePath = ref.path as string | undefined;
      if (!filePath) continue;

      // Create or reuse CodeFile entity for this path
      const sanitized = filePath.replace(/[^a-zA-Z0-9]/g, '-');
      const codeFileId = `code-file-${sanitized}`;

      if (!codeFileMap.has(codeFileId)) {
        codeFileMap.set(codeFileId, {
          id: codeFileId,
          displayId: filePath,
          type: ENTITY_TYPE.CodeFile,
          layer: 'code',
          fileOrigin: '',
          summary: filePath,
          data: { path: filePath, clusterDomain: sourceDomain },
        });
      }

      const role = ref.role as string | undefined;
      const line = ref.line as number | undefined;
      const description = ref.description as string | undefined;

      relations.push({
        id: `${entity.id}--${RELATION_TYPE.CodeRef}--${codeFileId}`,
        source_entity_id: entity.id,
        target_entity_id: codeFileId,
        type: RELATION_TYPE.CodeRef,
        data: {
          path: filePath,
          ...(role != null && { role }),
          ...(line != null && { line }),
          ...(description != null && { description }),
        },
      });
    }
  }

  return {
    relations,
    codeFileEntities: Array.from(codeFileMap.values()),
  };
}

/**
 * Derive the domain (bounded context) from an entity so CodeFile nodes can
 * cluster with the entities that reference them.
 * Mirrors the frontend getEntityDomain logic but kept minimal to avoid cross-deps.
 */
function deriveEntityDomain(entity: Entity): string {
  // displayId prefix: "content.CN001" → "content"
  const displayId = entity.displayId ?? '';
  const dotIdx = displayId.indexOf('.');
  if (dotIdx > 0) {
    const prefix = displayId.substring(0, dotIdx);
    if (/^[a-z][a-z0-9-]*$/.test(prefix)) return prefix;
  }
  // fileOrigin first segment: "content/concepts.yaml" → "content"
  const fo = entity.fileOrigin ?? '';
  if (fo) {
    const segments = fo.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.length > 1 && segments[0] !== '.migrations') return segments[0]!;
  }
  // entity.id prefix: "content-concepts.yaml-CN001" → "content"
  const id = entity.id ?? '';
  const dashIdx = id.indexOf('-');
  if (dashIdx > 0) return id.substring(0, dashIdx);
  return 'default';
}
