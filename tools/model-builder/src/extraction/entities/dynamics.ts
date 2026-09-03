import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['dynamics']!;

/**
 * The three id-bearing collections of `dynamics.schema.yaml`.
 *
 * All three emit ONE entity type. `migration/changes/applyEntityChanges.ts` already maps
 * `parallelism`, `ordering` and `race-condition` to `ENTITY_TYPE.Dynamics`, so an entity created
 * through `bp new` is typed `Dynamics` today. Emitting a type per family here would make the
 * extractor and the mutation path disagree about the same entity, and which answer the graph got
 * would depend on which door the entity came through.
 *
 * `execution` and `resources` are singleton objects with no `id`. They describe the document rather
 * than naming a thing in it, so they are not entities and are reachable through the file's data.
 */
const DYNAMICS_COLLECTIONS: { key: string; family: string }[] = [
  { key: 'parallelism', family: 'parallelism' },
  { key: 'ordering', family: 'ordering' },
  { key: 'race_conditions', family: 'race-condition' },
];

/**
 * Which field carries this family's human-readable name, and which its prose.
 *
 * The three families do not share a field vocabulary, so a single `name ?? title` chain of the kind
 * `quality.ts` uses is not enough: **`ordering[]` has no `name` at all**, only `summary`. Without a
 * per-family answer every ordering constraint in the graph would be an unlabelled node, which reads
 * as missing data rather than as a schema that names things differently.
 *
 * Each chain falls back only to a field that says the same KIND of thing. `race_condition.scenario`
 * is the interleaving that constitutes the hazard, and `ordering.note` is additional context about
 * the constraint, so either standing in for an absent `description` is still a description of the
 * entity. `parallelism.benefit` is not: "2-3x speedup on multi-core" is a claim about the payoff, and
 * promoting it would present a benefit as a description of the opportunity. It stays in `data`,
 * where a consumer that wants it can ask for it by name.
 *
 * Nothing is duplicated across slots either. `summary` is carried in `summary`, and for `ordering`
 * in `term` as well - so it is deliberately absent from the description chain, where it would put
 * one sentence in three fields and make an unset description indistinguishable from a set one.
 */
const PROSE_BY_FAMILY: Record<string, { name?: string[]; description: string[] }> = {
  parallelism: { name: ['name'], description: ['description'] },
  ordering: { description: ['description', 'note'] },
  'race-condition': { name: ['name'], description: ['description', 'scenario'] },
};

/** First present, non-empty string among `keys`. */
function firstString(item: Record<string, unknown>, keys: string[] | undefined): string | undefined {
  if (!keys) return undefined;
  for (const key of keys) {
    const value = item[key];
    if (value != null && String(value) !== '') return String(value);
  }
  return undefined;
}

export function extractDynamics(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  for (const { key, family } of DYNAMICS_COLLECTIONS) {
    const collection = data[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const prose = PROSE_BY_FAMILY[family]!;
      const name = firstString(item, prose.name);
      const summary = firstString(item, ['summary']);
      const description = firstString(item, prose.description);
      entities.push({
        id: makeInternalId(doc.scope, doc.filePath, displayId),
        displayId,
        type: ENTITY_TYPE.Dynamics,
        layer: LAYER,
        fileOrigin: doc.filePath,
        // An ordering constraint's `summary` IS its name, so `term` falls back to it rather than
        // leaving the node label empty.
        summary: summary ?? name,
        term: name ?? summary,
        description,
        // `_dynamics_family` is what the three families are told apart by downstream, since the
        // entity type cannot carry it. The relation extractor reads it, and so can a rule that
        // wants race conditions without matching every PAR and ORD beside them.
        data: { ...item, _dynamics_family: family },
      });
    }
  }

  return entities;
}
