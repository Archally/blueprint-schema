import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

/**
 * Party identity — the rule, shared; the call site, per stack.
 *
 * A party is ONE node, dual-sourced: `arch.yaml` describes what it runs, `organization.yaml`
 * describes how it is staffed, and `arch.schema.yaml`'s `party.id` says the two reconcile on a
 * single `PRT###`. Extraction emits a row per declaration, so something has to fold them.
 *
 * Two properties are deliberate:
 *
 * 1. **Id-first, name only as a fallback.** A declared `PRT###` is authoritative and merges
 *    silently. A name-keyed merge is a *guess*, so it is reported — never silent.
 * 2. **The name fallback is scoped.** `scope` is the slice folder, and the schema requires
 *    `parties` at arch document root, so a context map split across slices re-declares the party by
 *    design. Those rows stay separate until they carry a shared id, because merging them would be
 *    inference at read time — permanent, unreviewable drift. Writing the ids is a migration, where
 *    the decision is a diff a human approves.
 *
 * This module holds the rule so both stacks agree on WHICH rows are the same party. Each stack still
 * assembles its own model and decides when to call `mergeParties`.
 */

/**
 * `metamodel.schema.yaml#/$defs/party_ref` permits an optional context prefix, so `billing.PRT001`
 * and `PRT001` denote one party.
 */
export function normalisePartyRef(ref: string): string {
  const segments = String(ref).split('.');
  return segments[segments.length - 1]!;
}

/** `id:<PRT###>` when the row declares one, else `name:<scope>::<name>`. */
export function partyIdentityKey(entity: Entity): string {
  const declared = (entity.data as Record<string, unknown> | undefined)?.id;
  if (typeof declared === 'string' && declared.length > 0) {
    return `id:${normalisePartyRef(declared)}`;
  }
  const scope = (entity.data as Record<string, unknown> | undefined)?._scope;
  return `name:${typeof scope === 'string' ? scope : ''}::${entity.displayId ?? ''}`;
}

/** A merge the rule performed on a guess rather than on a declared id. */
export interface PartyMergeWarning {
  /** The name the rows shared. */
  party: string;
  /** Files that contributed a row, in declaration order. */
  files: string[];
}

/**
 * Two parts of one party define the same member with different values.
 *
 * Reported, never resolved: choosing between them would be read-time inference, and the honest fix
 * is in the model — one party should not carry seven descriptions. The fold does not create this
 * inconsistency, it reveals one the duplication was hiding.
 */
export interface PartyMemberConflict {
  /** The party's name. */
  party: string;
  /** The member key the parts disagree on. */
  key: string;
  /** Files declaring a part, in declaration order. */
  sources: string[];
}

export interface MergePartiesResult {
  entities: Entity[];
  warnings: PartyMergeWarning[];
  /** Members two parts define differently. Empty when every part agrees. */
  conflicts: PartyMemberConflict[];
  /**
   * Internal id of every folded-away row → the id that survived.
   *
   * Folding two rows into one node deletes an id, and any relation still pointing at it would
   * silently vanish — which is how a de-duplication quietly becomes data loss. Callers must rewrite
   * their relation endpoints through this map. It matters most for the arch↔org fold: org parties
   * own departments and teams, so the org row is an edge endpoint even though arch rows are not.
   */
  idRemap: Map<string, string>;
}

/**
 * Fold Party entities that denote the same party, preserving order and leaving every other entity
 * untouched.
 *
 * A party is a **partial class**: no declaration is authoritative or complete, and the node is the
 * UNION OF ALL MEMBERS across its parts. A key only one part declares is copied in; arrays present
 * in several parts are unioned; a scalar two parts define differently keeps the first part's value
 * and is reported as a conflict. `data._sources` lists every contributing file.
 *
 * Unioning only `contexts` — the original behaviour — silently dropped the entire org facet
 * (`departments`, `teams`) from a node whose `_sources` claimed to include `organization.yaml`.
 * The relations survived, so the graph stayed correct while the node itself lied.
 *
 * The surviving node keeps the first row's internal `id`, so every folded row's id disappears. That
 * is **not** free: an *org* party owns departments and teams, so it IS a relation endpoint. (Arch
 * parties are not — relations there resolve against Context/Service/Contract, which this fold leaves
 * untouched. Assuming the arch case generalised cost 14 edges on a real model before it was measured.)
 * Callers must therefore run `remapRelationEndpoints` over their relations with `idRemap`.
 */
export function mergeParties(entities: Entity[]): MergePartiesResult {
  const byKey = new Map<string, Entity>();
  const contributors = new Map<string, string[]>();
  const idRemap = new Map<string, string>();
  const conflicts: PartyMemberConflict[] = [];
  const result: Entity[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Party) {
      result.push(entity);
      continue;
    }

    const key = partyIdentityKey(entity);
    const origin = entity.fileOrigin ?? '';
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, entity);
      contributors.set(key, origin ? [origin] : []);
      const data = (entity.data ??= {}) as Record<string, unknown>;
      if (origin) data._sources = [origin];
      result.push(entity);
      continue;
    }

    if (origin) {
      const seen = contributors.get(key)!;
      if (!seen.includes(origin)) seen.push(origin);
      (existing.data as Record<string, unknown>)._sources = [...seen];
    }
    if (entity.id !== existing.id) idRemap.set(entity.id, existing.id);
    unionMembers(existing, entity, conflicts, contributors.get(key)!);
  }

  const warnings: PartyMergeWarning[] = [];
  for (const [key, files] of contributors) {
    if (!key.startsWith('name:') || files.length < 2) continue;
    warnings.push({ party: key.slice(key.indexOf('::') + 2), files });
  }

  // `sources` is the live contributor array while parts accumulate; snapshot it so a conflict
  // reports every contributing file and nothing aliases the map's internals.
  const settledConflicts = conflicts.map((conflict) => ({ ...conflict, sources: [...conflict.sources] }));

  return { entities: result, warnings, conflicts: settledConflicts, idRemap };
}

/**
 * Rewrite relation endpoints through a `mergeParties` remap. Relations that become self-loops are
 * dropped — two rows of one party pointing at each other says nothing once they are one node.
 */
export function remapRelationEndpoints(
  relations: Relation[],
  idRemap: Map<string, string>,
): Relation[] {
  if (idRemap.size === 0) return relations;
  const remapped: Relation[] = [];
  for (const relation of relations) {
    const source = idRemap.get(relation.source_entity_id) ?? relation.source_entity_id;
    const target = idRemap.get(relation.target_entity_id) ?? relation.target_entity_id;
    if (source === target) continue;
    remapped.push(
      source === relation.source_entity_id && target === relation.target_entity_id
        ? relation
        : { ...relation, source_entity_id: source, target_entity_id: target },
    );
  }
  return remapped;
}

/**
 * Keys that establish WHICH party this is, rather than describing it. They are settled by the
 * identity rule before any member is merged, so folding them would be circular.
 *
 * `id` never needs copying: a part without an id keys on `name:<scope>::<name>` and a part with one
 * keys on `id:<PRT###>`, so two parts that disagree about having an id can never share a key and
 * never reach this function.
 */
const IDENTITY_KEYS = new Set(['id', 'name', '_scope', '_sources']);

/** A member's identity within its array — `id`, else `name`, else the value itself. */
function memberKey(member: unknown): string {
  const record = member as { id?: unknown; name?: unknown } | null;
  if (record && typeof record === 'object') {
    if (typeof record.id === 'string' && record.id.length > 0) return `id:${record.id}`;
    if (typeof record.name === 'string' && record.name.length > 0) return `name:${record.name}`;
  }
  return `raw:${JSON.stringify(member)}`;
}

/** Append members of `additions` whose key is not already present. First declaration wins. */
function unionArray(existing: unknown[], additions: unknown[]): unknown[] {
  const seen = new Set(existing.map(memberKey));
  for (const member of additions) {
    const key = memberKey(member);
    if (seen.has(key)) continue;
    existing.push(member);
    seen.add(key);
  }
  return existing;
}

/**
 * Fold `incoming`'s members into `target` — the partial-class union.
 *
 * A key `target` does not declare is copied. Arrays both declare are unioned by member identity
 * (`id ?? name`), which subsumes the original union-by-context-name: checked against the corpus
 * before generalising, 92 context rows across 15 folding groups produced 0 same-name/different-id
 * clashes, so the two rules agree here. A scalar both declare keeps `target`'s value and is
 * reported.
 */
function unionMembers(
  target: Entity,
  incoming: Entity,
  conflicts: PartyMemberConflict[],
  sources: string[],
): void {
  const targetData = (target.data ??= {}) as Record<string, unknown>;
  const incomingData = (incoming.data ?? {}) as Record<string, unknown>;

  for (const [key, value] of Object.entries(incomingData)) {
    if (IDENTITY_KEYS.has(key) || value === undefined) continue;

    const current = targetData[key];
    if (current === undefined) {
      targetData[key] = value;
      continue;
    }
    if (Array.isArray(current) && Array.isArray(value)) {
      targetData[key] = unionArray(current, value);
      continue;
    }
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      const party = String(target.displayId ?? '');
      if (!conflicts.some((conflict) => conflict.party === party && conflict.key === key)) {
        conflicts.push({ party, key, sources });
      }
    }
  }
}
