import type { Entity, ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['blueprint']!;

/**
 * Extract ChangeStream entities from the model root document's `change_streams:` registry.
 *
 * A change stream groups migrations for a reader and states nothing else: no team and no scope.
 * Its teams are the owners of its migrations and its reach is the reach of its migrations, so the
 * node carries the registry entry as declared and every derived fact is read from the migrations
 * that name it (`migration_in_change_stream`). The registry lives in `blueprint.yaml`, so the layer
 * is the one the `blueprint` schema type already has, as for the domain registry.
 */
export function extractChangeStreams(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const streams = (doc.data ?? {}).change_streams as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(streams)) return entities;

  for (const stream of streams) {
    if (!stream || typeof stream !== 'object' || stream.id == null) continue;
    const displayId = String(stream.id);
    const name = stream.name != null ? String(stream.name) : undefined;
    entities.push({
      id: makeInternalId(doc.scope, doc.filePath, displayId),
      displayId,
      type: ENTITY_TYPE.ChangeStream,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: name,
      term: name,
      description: stream.description != null ? String(stream.description) : undefined,
      data: stream,
    });
  }
  return entities;
}
