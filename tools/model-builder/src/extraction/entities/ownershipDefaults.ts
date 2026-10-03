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
 * **Only an array item under a container the model's schema line lets own is annotated.** The table
 * is the schema's own answer to "may this be owned", derived from it rather than chosen: every array
 * property whose item definition declares an `owned_by` property, read per line, because the lines
 * differ. Where the schema gives a type no way to name an owner, a default cannot manufacture one -
 * an arch `contract` is the case that makes this concrete, an infrastructure `environment` and
 * `binding` are two more, and an assumption in a v2.6 or v2.7 model is a fourth: those lines give it
 * no `owned_by`, so a file-level owner does not reach it there, while on v2.8 it does.
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
 * The schema lines this table has a row for, oldest first. A model declares its line in the root
 * `blueprint.yaml` (`schemaVersion`); `resolveSchemaLine` maps that declaration onto one of these.
 */
export const SERVED_SCHEMA_LINES = ['v2.6', 'v2.7', 'v2.8'] as const;

/** A schema line the ownership table has a row for. */
export type ServedSchemaLine = (typeof SERVED_SCHEMA_LINES)[number];

const OLDEST_SERVED_LINE: ServedSchemaLine = SERVED_SCHEMA_LINES[0];
const NEWEST_SERVED_LINE: ServedSchemaLine = SERVED_SCHEMA_LINES[SERVED_SCHEMA_LINES.length - 1]!;

/** The containers every served line lets name an owner. */
const COMMON_CONTAINERS = [
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
  'goals',
  'happy_path',
  'inquiries',
  'metrics',
  'milestones',
  'questions',
  'resources',
  'risks',
  'screens',
  'services',
  'structural',
  'transition',
  'use_cases',
  'user_stories',
  'validation',
  'value_streams',
] as const;

/**
 * Array properties whose items the schema lets name an owner of their own, one row per served line.
 *
 * Each row is derived from its own line's schema tree by taking every array property whose item
 * definition declares an `owned_by` property, then removing `parties` for the reason above. A test
 * re-derives every row from its schema tree and fails when the two disagree, so a type that gains or
 * loses `owned_by` on a line is not a silent change here.
 *
 * The rows differ, and each difference is a container a file-level owner must not reach on the line
 * that gives its items no `owned_by`: `assumptions` and `probes` are ownable from v2.8,
 * `findings`, `leverage_points` and `work_items` from v2.7, and the narrative container is `stories`
 * up to v2.7 and `processes` from v2.8.
 */
const OWNING_CONTAINERS_BY_LINE: Readonly<Record<ServedSchemaLine, ReadonlySet<string>>> = {
  'v2.6': new Set([...COMMON_CONTAINERS, 'stories']),
  'v2.7': new Set([...COMMON_CONTAINERS, 'stories', 'findings', 'leverage_points', 'work_items']),
  'v2.8': new Set([
    ...COMMON_CONTAINERS,
    'processes',
    'findings',
    'leverage_points',
    'work_items',
    'assumptions',
    'probes',
  ]),
};

/** The container the table deliberately omits, named so the omission survives a re-derivation. */
export const ENVELOPE_CONTAINER = 'parties';

/** Every container some served line lets name an owner: the union of the rows. */
export const OWNING_CONTAINER_NAMES: readonly string[] = [
  ...new Set(SERVED_SCHEMA_LINES.flatMap((line) => [...OWNING_CONTAINERS_BY_LINE[line]])),
].sort();

/** Each served line's row, sorted, for the test that re-derives it from that line's schema. */
const sortedRow = (line: ServedSchemaLine): readonly string[] =>
  [...OWNING_CONTAINERS_BY_LINE[line]].sort();
export const OWNING_CONTAINER_NAMES_BY_LINE: Readonly<Record<ServedSchemaLine, readonly string[]>> = {
  'v2.6': sortedRow('v2.6'),
  'v2.7': sortedRow('v2.7'),
  'v2.8': sortedRow('v2.8'),
};

/**
 * The served line a model's declared `schemaVersion` is read under.
 *
 * Accepts `major.minor[.patch]`, with or without a leading `v`; the patch is ignored, because a
 * schema line is one per minor version. A declaration that is absent or unreadable is read as the
 * newest served line, which is the schema's own rule for an omitted `schemaVersion`. A declared line
 * outside the served range is clamped into it: an older one is read as the oldest served line, a
 * newer one as the newest.
 */
export function resolveSchemaLine(schemaVersion: unknown): ServedSchemaLine {
  if (typeof schemaVersion !== 'string') return NEWEST_SERVED_LINE;
  const match = /^v?(\d+)\.(\d+)(?:\.\d+)?$/.exec(schemaVersion.trim());
  if (!match) return NEWEST_SERVED_LINE;
  const declared = [Number(match[1]), Number(match[2])] as const;
  const compare = (line: ServedSchemaLine): number => {
    const [major, minor] = line.slice(1).split('.').map(Number) as [number, number];
    return declared[0] !== major ? declared[0] - major : declared[1] - minor;
  };
  if (compare(OLDEST_SERVED_LINE) < 0) return OLDEST_SERVED_LINE;
  if (compare(NEWEST_SERVED_LINE) > 0) return NEWEST_SERVED_LINE;
  return SERVED_SCHEMA_LINES.find((line) => compare(line) === 0) ?? NEWEST_SERVED_LINE;
}

function isOwnerObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Write the document's file-level owner onto every entity node that inherits it, reading the
 * container table of the model's schema line (the newest served line when none is given).
 *
 * Mutates `doc.data` in place, which is what lets the marker travel: two extractors spread the node
 * (`{ ...context }`) and two hand it over by reference (`data: item`), so a copy would reach one
 * pair and not the other. Idempotent - a second run over the same document recomputes the same
 * annotation - and a no-op for a document with no root `owned_by`, which is every document in most
 * models.
 */
export function annotateOwnershipDefaults(
  doc: ParsedBlueprintDocument,
  line: ServedSchemaLine = NEWEST_SERVED_LINE,
): void {
  const root = doc.data;
  if (!isOwnerObject(root)) return;
  const owner = root.owned_by;
  if (!isOwnerObject(owner)) return;

  const owningContainers = OWNING_CONTAINERS_BY_LINE[line];
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
      const mayOwn = owningContainers.has(key);
      for (const item of value) {
        if (!isOwnerObject(item)) continue;
        const declaresOwner = isOwnerObject(item.owned_by);
        if (mayOwn && !blocked && !declaresOwner) item[OWNED_BY_DEFAULT] = owner;
        visit(item, blocked || declaresOwner);
      }
    }
  }
}
