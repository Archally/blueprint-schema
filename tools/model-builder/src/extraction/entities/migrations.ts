import type { Entity, ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

/**
 * Migrations, from both documents that describe them.
 *
 * A model says where it has been in one of two ways, and they are two documents with two schemas
 * rather than two spellings of one:
 *
 *   · `migrations.yaml` is the REGISTER - an ordered list of entries written for a reader, whose
 *     changes are prose and whose entities are named only where naming one helps.
 *   · `<name>.migration.yaml` is a CHANGE PROGRAM - one migration authored for execution, with a
 *     typed target per change and the data to reverse it.
 *
 * Both produce a `Migration` node, because the reader-facing facts are the same facts: an id, a
 * name, when it happened, where it stands and what it touched. Which document a node came from is
 * carried as `_genre`, and it is not decoration - the two `status` vocabularies are different
 * vocabularies, so a reader needs to know which one they are in before reading `status`.
 *
 * WHAT IS DELIBERATELY NOT READ. `migration.properties` is the open `entity_properties` bag
 * (`additionalProperties: true`), and two models in this corpus use it for `motivation_shift`,
 * `organization_impact` and `scenario_refs`. Those are an author's convention, not schema. Deriving
 * from them would make an undeclared key load-bearing, and the next model using that word for
 * something else would be silently wrong. Only declared fields are read.
 *
 * The node is PLANELESS by construction rather than by exception: both adapters derive a plane from
 * the layer prefix and accept only `design` and `governance`, so `migrations` yields none without
 * either adapter learning what a migration is.
 */

const LAYER = SCHEMA_TYPE_TO_LAYER['migrations']!;

/** Which document the node came from. Decides which vocabulary `status` is drawn from. */
export type MigrationGenre = 'register' | 'change-program';

function text(value: unknown): string | undefined {
  return value != null ? String(value) : undefined;
}

/**
 * The coarse `_affects` list the ruling settled on: every entity a migration names, agnostic to
 * what it does to it.
 *
 * A PER-CHANGE edge was rejected and this is what replaces it. `MIG --removes--> X` is an edge to a
 * node the graph expressing it does not contain, and the same objection in reverse applies to an
 * `add`. One list, ranging over what the model held before and what it holds after, answers "what
 * did this touch" without asserting a direction the graph cannot represent.
 *
 * Both documents are read from the same function because both answer the same question, in two
 * shapes: the change program names a `target` per entity change, the register an optional `entity`
 * per prose change. The register's is optional BY DESIGN - a change may describe a whole file, a
 * slice or a convention - so an entry naming nothing is a legal record, not an omission.
 */
function collectAffects(data: Record<string, unknown>, item: Record<string, unknown>): string[] {
  const refs: string[] = [];

  // Change program: `changes.entities[].target`, a sibling of `migration:` at the document root.
  const changes = data.changes as { entities?: unknown } | undefined;
  if (changes && typeof changes === 'object' && Array.isArray(changes.entities)) {
    for (const change of changes.entities as Record<string, unknown>[]) {
      if (change && typeof change.target === 'string' && change.target) refs.push(change.target);
    }
  }

  // Register: `changes[].entity` on the entry itself.
  if (Array.isArray(item.changes)) {
    for (const change of item.changes as Record<string, unknown>[]) {
      if (change && typeof change.entity === 'string' && change.entity) refs.push(change.entity);
    }
  }

  return [...new Set(refs)];
}

/**
 * Build one node from an already-identified migration record.
 *
 * `_genre` and `_impact` are derived and carry the underscore the rest of this builder uses for a
 * value the model did not write - `_owned_by_default`, `_system_ref_default`, `_domain_ref_default`.
 * `_impact` exists because the register spells the field `impact` and the change program spells it
 * `semver_impact` while both reference the same `semver_impact` definition: one vocabulary under two
 * keys, so it is resolved once here instead of in every consumer. `status` is NOT resolved that way,
 * and the reason is that the two enums are not one vocabulary - `cancelled` (never happened) and
 * `rolled-back` (happened, then undone) are different facts, and any mapping between the two sets
 * loses that distinction silently.
 */
function toEntity(
  doc: ParsedBlueprintDocument,
  item: Record<string, unknown>,
  genre: MigrationGenre,
): Entity | null {
  if (item.id == null) return null;
  const displayId = String(item.id);
  const name = text(item.name);
  const impact = item.impact ?? item.semver_impact;
  const affects = collectAffects(doc.data ?? {}, item);

  return {
    id: makeInternalId(doc.scope, doc.filePath, displayId),
    displayId,
    type: ENTITY_TYPE.Migration,
    layer: LAYER,
    fileOrigin: doc.filePath,
    summary: name,
    term: name,
    description: text(item.description),
    data: {
      ...item,
      _genre: genre,
      ...(impact != null ? { _impact: String(impact) } : {}),
      ...(affects.length > 0 ? { _affects: affects } : {}),
    },
  };
}

export function extractMigrations(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};

  // The register: an array under `migrations`, one node per entry.
  const register = data.migrations as Record<string, unknown>[] | undefined;
  if (Array.isArray(register)) {
    for (const item of register) {
      if (!item || typeof item !== 'object') continue;
      const entity = toEntity(doc, item, 'register');
      if (entity) entities.push(entity);
    }
  }

  // The change program: a single `migration` object per document. Its `changes` sit beside it at
  // the document root rather than inside it, which is why `collectAffects` is given the document.
  const program = data.migration as Record<string, unknown> | undefined;
  if (program && typeof program === 'object' && !Array.isArray(program)) {
    const entity = toEntity(doc, program, 'change-program');
    if (entity) entities.push(entity);
  }

  return entities;
}
