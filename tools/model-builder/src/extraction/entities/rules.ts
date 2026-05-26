import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['rules']!;

const RULE_COLLECTIONS: { key: string; type: string }[] = [
  { key: 'structural', type: ENTITY_TYPE.StructuralRule },
  { key: 'classification', type: ENTITY_TYPE.ClassificationRule },
  { key: 'derivation', type: ENTITY_TYPE.DerivationRule },
  { key: 'equivalence', type: ENTITY_TYPE.EquivalenceRule },
  { key: 'validation', type: ENTITY_TYPE.ValidationRule },
  { key: 'transition', type: ENTITY_TYPE.TransitionRule },
];

function toRuleEntity(
  doc: ParsedBlueprintDocument,
  type: string,
  item: Record<string, unknown>
): Entity {
  const displayId = String(item.id ?? '');
  const id = makeInternalId(doc.scope, doc.filePath, displayId);
  const summary = item.summary != null ? String(item.summary) : undefined;
  const name = item.name != null ? String(item.name) : undefined;
  const description = item.description != null ? String(item.description) : undefined;
  return {
    id,
    displayId,
    type,
    layer: LAYER,
    fileOrigin: doc.filePath,
    summary: summary ?? name,
    term: name,
    description,
    data: item,
  };
}

export function extractRules(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  for (const { key, type } of RULE_COLLECTIONS) {
    const arr = data[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && typeof item === 'object' && item.id != null) {
        entities.push(toRuleEntity(doc, type, item as Record<string, unknown>));
      }
    }
  }

  return entities;
}
