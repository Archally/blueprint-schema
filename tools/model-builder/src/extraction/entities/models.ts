import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['models']!;

/**
 * Model categories within a models document.
 * - schema: concept models (components.schemas)
 * - x-field: partial/contract-specific field types (components.x-field)
 * - x-parameter: reusable parameter definitions (components.x-parameter)
 */
type ModelCategory = 'schema' | 'x-field' | 'x-parameter';

const COMPONENT_SECTIONS: Array<{ key: string; category: ModelCategory }> = [
  { key: 'schemas', category: 'schema' },
  { key: 'x-field', category: 'x-field' },
  { key: 'x-parameter', category: 'x-parameter' },
];

/**
 * Extract model entities from one models document.
 *
 * Schema shape:
 *   components:
 *     schemas:
 *       SchemaName: { x-model-id?, purpose?, description?, represents?, ... }
 *     x-field:
 *       FieldName: { type, format?, description?, ... }
 *     x-parameter:
 *       ParamName: { name, in, schema?, description?, ... }
 *
 * Uses x-model-id (MDL###) as displayId when present, schema key name as fallback.
 * Stores _modelCategory ('schema' | 'x-field' | 'x-parameter') on entity data.
 */
export function extractModels(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const components = data.components as Record<string, unknown> | undefined;
  if (!components || typeof components !== 'object') return entities;

  for (const { key, category } of COMPONENT_SECTIONS) {
    const section = components[key] as Record<string, unknown> | undefined;
    if (!section || typeof section !== 'object') continue;

    for (const [schemaName, schema] of Object.entries(section)) {
      if (!schema || typeof schema !== 'object') continue;
      const item = schema as Record<string, unknown>;
      const modelId = item['x-model-id'] as string | undefined;
      const displayId = modelId ?? schemaName;
      const id = makeInternalId(doc.scope, doc.filePath, displayId);
      const description = item.description != null ? String(item.description) : undefined;
      const purpose = item.purpose != null ? String(item.purpose) : undefined;

      entities.push({
        id,
        displayId,
        type: ENTITY_TYPE.Models,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: description ?? purpose,
        term: schemaName,
        description,
        data: { ...item, _schemaName: schemaName, _modelCategory: category },
      });
    }
  }

  return entities;
}
