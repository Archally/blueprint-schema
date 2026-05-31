import type {
  CheckableModel,
  CheckableEntity,
  CheckableRelation,
  PlaneDecl,
  LayerDecl,
} from '@archally/semantic-checker';
import type { BlueprintModel } from '@archally/blueprint-schema/model';

/**
 * Blueprint relation types → the engine's canonical epistemic vocabulary (checker-IR contract §3).
 * Rename only — the edge direction already matches what the rules expect:
 *   `validates`            : test → rule          ⇒ rule has an INCOMING `validated-by`
 *   `question_answered_by` : question → operation ⇒ question has an OUTGOING `answered-by`
 * `produces` and all other types pass through unchanged (orphan-entities counts any edge).
 */
const RELATION_TYPE_RENAME: Record<string, string> = {
  validates: 'validated-by',
  question_answered_by: 'answered-by',
};

/** Blueprint `layer` ids are plane-namespaced (`design.domain`, `governance.tests`). */
function planeOfLayer(layer: string): string | undefined {
  const prefix = layer.split('.')[0];
  return prefix === 'design' || prefix === 'governance' ? prefix : undefined;
}

/**
 * Normalize the blueprint built model (`buildBlueprintModel` output) into the engine's
 * `CheckableModel` (checker-IR contract §6).
 *
 * - `term` → `name`; `displayId` and `fileOrigin` carried for messages; raw entity → `data`.
 * - `plane` derived from the layer prefix; `layer` kept verbatim.
 * - relations: `source_entity_id`/`target_entity_id` → `source`/`target`, type normalized.
 * - `structure` declares the design/governance planes and their layers (not read by the six
 *   ported rules, but kept faithful for structural checks and future rules).
 */
export function toCheckableModel(model: BlueprintModel): CheckableModel {
  const entities: CheckableEntity[] = model.entities.map(entity => ({
    id: entity.id,
    displayId: entity.displayId,
    name: entity.term,
    type: entity.type,
    plane: planeOfLayer(entity.layer),
    layer: entity.layer,
    slices: [],
    data: entity.data ?? {},
    fileOrigin: entity.fileOrigin,
  }));

  const relations: CheckableRelation[] = model.relations.map(relation => ({
    id: relation.id,
    source: relation.source_entity_id,
    target: relation.target_entity_id,
    type: RELATION_TYPE_RENAME[relation.type] ?? relation.type,
    predicate: relation.predicate ?? relation.type,
    data: relation.data,
  }));

  const planeByLayer = new Map<string, string | undefined>();
  for (const entity of model.entities) {
    if (!planeByLayer.has(entity.layer)) planeByLayer.set(entity.layer, planeOfLayer(entity.layer));
  }
  const planes: PlaneDecl[] = [...new Set(
    [...planeByLayer.values()].filter((plane): plane is string => plane !== undefined),
  )].map(id => ({ id }));
  const layers: LayerDecl[] = [...planeByLayer.entries()]
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([id, plane]) => ({ id, plane }));

  return {
    schema: 'blueprint',
    structure: { planes, layers, slices: [] },
    entities,
    relations,
    metadata: {
      builtAt: model.metadata.last_loaded ?? undefined,
      entityTypeCounts: undefined,
      planeCounts: undefined,
      relationTypeCounts: undefined,
    },
  };
}
