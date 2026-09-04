import type { ParsedBlueprintDocument } from '../../model/types.js';

/**
 * A document root may carry `owned_by`, which the schema describes as a file-level default:
 * *"File-level ownership default. Entities inherit unless overridden."* Only the entity-level half
 * reaches the graph on its own, because an `Entity` records neither its depth in the document nor
 * whether an ancestor claimed it. This module supplies the missing half by annotating the parsed
 * document BEFORE extraction, so each extractor carries the inherited owner through its own
 * identity logic rather than having that logic reproduced here.
 *
 * The annotation is written under `_owned_by_default`, joining `_party`, `_context` and `_scope` as
 * document-derived metadata an extractor spreads into `entity.data`. It is a separate key from
 * `owned_by` so a consumer holding an entity can still tell what the model SAID from what it
 * inherited; `extractOrgOwnershipRelations` marks the resulting edge `data.inherited`.
 *
 * ## Three rules, each of which excludes edges a looser one would invent
 *
 * **An ancestor that declares an owner blocks the default, and does not replace it.** The schema
 * defines a file-level default and an entity-level statement; it defines no inheritance between
 * entities. A service inside a context that names an owner therefore inherits nothing - the
 * context's statement is about the context. Blocking rather than substituting is what keeps this
 * module from quietly shipping a second, undeclared inheritance rule.
 *
 * **Only an array item under a container in `OWNING_CONTAINERS` is annotated.** The table is the
 * schema's own answer to "may this be owned", derived from it rather than chosen: every array
 * property whose item definition declares an `owned_by` property. Where the schema gives a type no
 * way to name an owner, a default cannot manufacture one - an arch `contract` is the case that
 * makes this concrete, and an infrastructure `environment` and `binding` are two more.
 *
 * **A `parties` item is never annotated**, although `party` does declare `owned_by`. An arch
 * document nests its contexts inside the party that hosts them, so a party is re-declared by every
 * document describing one of its contexts. Those occurrences are one party, and each sits in a file
 * with its own default - so annotating them attaches as many owners to that party as there are
 * files, each one true of the file and none true of the party. A model that splits eleven contexts
 * across seven documents produces exactly that. An owner stated ON a party is a statement rather
 * than a default, and is emitted unchanged.
 */

/** The key an inherited file-level owner is written under. */
export const OWNED_BY_DEFAULT = '_owned_by_default';

/**
 * Array properties whose items the schema lets name an owner of their own.
 *
 * Derived from the v2.7 schema by taking every array property whose item definition declares an
 * `owned_by` property, then removing `parties` for the reason above. A test re-derives it from the
 * schema and fails when the two disagree, so a type that gains or loses `owned_by` is not a silent
 * change here.
 */
const OWNING_CONTAINERS: ReadonlySet<string> = new Set([
  'actions',
  'actors',
  'business_decisions',
  'capabilities',
  'children',
  'classification',
  'concepts',
  'contexts',
  'decisions',
  'derivation',
  'edge_cases',
  'equivalence',
  'error_cases',
  'findings',
  'goals',
  'happy_path',
  'inquiries',
  'leverage_points',
  'metrics',
  'milestones',
  'questions',
  'resources',
  'risks',
  'screens',
  'services',
  'stories',
  'structural',
  'transition',
  'use_cases',
  'user_stories',
  'validation',
  'value_streams',
  'work_items',
]);

/** The container the table deliberately omits, named so the omission survives a re-derivation. */
export const ENVELOPE_CONTAINER = 'parties';

/** Every container the table covers, for the test that re-derives it from the schema. */
export const OWNING_CONTAINER_NAMES: readonly string[] = [...OWNING_CONTAINERS].sort();

function isOwnerObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Write the document's file-level owner onto every entity node that inherits it.
 *
 * Mutates `doc.data` in place, which is what lets the marker travel: two extractors spread the node
 * (`{ ...context }`) and two hand it over by reference (`data: item`), so a copy would reach one
 * pair and not the other. Idempotent - a second run over the same document recomputes the same
 * annotation - and a no-op for a document with no root `owned_by`, which is every document in most
 * models.
 */
export function annotateOwnershipDefaults(doc: ParsedBlueprintDocument): void {
  const root = doc.data;
  if (!isOwnerObject(root)) return;
  const owner = root.owned_by;
  if (!isOwnerObject(owner)) return;

  visit(root, false);

  function visit(node: Record<string, unknown>, blocked: boolean): void {
    for (const [key, value] of Object.entries(node)) {
      if (!Array.isArray(value)) {
        // A plain object is never annotated - the schema puts every ownable entity in an array - but
        // it is descended, and an owner declared on it blocks what is under it exactly as an array
        // item's does. The two branches must agree on blocking or a container moved under an object
        // key would start inheriting past an owner that was already stated.
        if (isOwnerObject(value)) visit(value, blocked || isOwnerObject(value.owned_by));
        continue;
      }
      const mayOwn = OWNING_CONTAINERS.has(key);
      for (const item of value) {
        if (!isOwnerObject(item)) continue;
        const declaresOwner = isOwnerObject(item.owned_by);
        if (mayOwn && !blocked && !declaresOwner) item[OWNED_BY_DEFAULT] = owner;
        visit(item, blocked || declaresOwner);
      }
    }
  }
}
