import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { createPlaceholder, entityDomain, resolveRef } from './resolver.js';

/**
 * Extract structural relations from org entities:
 * - Party → Department (containment, via department._party matching party.displayId)
 * - Department → Team (has, via department.teams[] refs)
 * - Party → Team (containment, via team._party matching party.displayId)
 */
export function extractOrgRelations(entities: Entity[]): Relation[] {
  const relations: Relation[] = [];

  const parties = entities.filter((e) => e.type === ENTITY_TYPE.Party);
  const departments = entities.filter((e) => e.type === ENTITY_TYPE.Department);
  const teams = entities.filter((e) => e.type === ENTITY_TYPE.Team);

  // Party → Department (via _party metadata)
  for (const dept of departments) {
    const parentPartyId = (dept.data as Record<string, unknown>)?._party as string | undefined;
    if (!parentPartyId) continue;
    const party = parties.find((p) => p.displayId === parentPartyId);
    if (!party) continue;
    relations.push({
      id: `${party.id}--${RELATION_TYPE.OrgContainsDept}--${dept.id}`,
      source_entity_id: party.id,
      target_entity_id: dept.id,
      type: RELATION_TYPE.OrgContainsDept,
    });
  }

  // Department → Team (via department.teams[] ref strings)
  for (const dept of departments) {
    const teamRefs = (dept.data as Record<string, unknown>)?.teams as string[] | undefined;
    if (!Array.isArray(teamRefs)) continue;
    for (const ref of teamRefs) {
      if (typeof ref !== 'string') continue;
      const team = teams.find((t) => t.displayId === ref);
      if (!team) continue;
      relations.push({
        id: `${dept.id}--${RELATION_TYPE.DeptHasTeam}--${team.id}`,
        source_entity_id: dept.id,
        target_entity_id: team.id,
        type: RELATION_TYPE.DeptHasTeam,
      });
    }
  }

  // Party → Team (via _party metadata — direct teams on party)
  for (const team of teams) {
    const parentPartyId = (team.data as Record<string, unknown>)?._party as string | undefined;
    if (!parentPartyId) continue;
    const party = parties.find((p) => p.displayId === parentPartyId);
    if (!party) continue;
    relations.push({
      id: `${party.id}--${RELATION_TYPE.OrgContainsTeam}--${team.id}`,
      source_entity_id: party.id,
      target_entity_id: team.id,
      type: RELATION_TYPE.OrgContainsTeam,
    });
  }

  return relations;
}

/**
 * The three arms of `owned_by`, and the entity type each one names.
 *
 * Resolution is scoped to the arm's OWN type rather than to every entity in the model. A ref written
 * under `team:` that names a `PRT###` is a mistake, and resolving it anyway would draw an edge to a
 * Party while the model claims a Team owns the unit - one error rendered as a fact. Scoped, it
 * becomes a Missing placeholder, which is visible.
 */
const OWNER_ARMS: ReadonlyArray<readonly [string, string]> = [
  ['team', ENTITY_TYPE.Team],
  ['department', ENTITY_TYPE.Department],
  ['party', ENTITY_TYPE.Party],
];

/**
 * Resolve a ref against entities of ONE type, falling back to a shared Missing placeholder.
 *
 * `resolveOrPlaceholder` searches every entity, which is right for a ref key whose target type is
 * implied by the key itself. `owned_by`'s arms each name a different type, so the type is part of
 * what the model said and filtering by it is not a narrowing - it is reading the statement.
 */
function resolveTypedOrPlaceholder(
  ref: string,
  expectedType: string,
  source: Entity,
  entities: Entity[],
  placeholders: Map<string, Entity>
): string {
  const candidates = entities.filter((e) => e.type === expectedType);
  const resolved = resolveRef(ref, entityDomain(source), candidates);
  if (resolved) return resolved;

  const placeholder = createPlaceholder(ref);
  if (!placeholders.has(placeholder.id)) {
    placeholders.set(placeholder.id, placeholder);
  }
  return placeholder.id;
}

/**
 * Extract the organizational ownership edge: any unit declaring `owned_by` -> the org unit it names.
 *
 * ONE relation type, `owned_by`, with `data.arm` naming which of the three arms produced it. The arm
 * is also recoverable from the target entity's type; `data.arm` exists so a consumer holding only the
 * edge does not need a second lookup.
 *
 * **Entity-level statements only.** A document may also carry a root `owned_by`, which is a default
 * for that file's TOP-LEVEL array items. It is not emitted here: `Entity` does not record whether it
 * was a top-level array item, so applying the default to every entity from the file would claim
 * ownership of nested services and contracts the document never mentions. A consumer should read
 * this edge set as the entity-level half of what a model states about ownership.
 */
export function extractOrgOwnershipRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    const ownedBy = (entity.data as Record<string, unknown> | undefined)?.owned_by;
    if (!ownedBy || typeof ownedBy !== 'object' || Array.isArray(ownedBy)) continue;

    for (const [arm, expectedType] of OWNER_ARMS) {
      const ref = (ownedBy as Record<string, unknown>)[arm];
      if (typeof ref !== 'string' || ref === '') continue;

      const targetId = resolveTypedOrPlaceholder(ref, expectedType, entity, entities, placeholders);
      relations.push({
        id: `${entity.id}--${RELATION_TYPE.OwnedBy}--${targetId}`,
        source_entity_id: entity.id,
        target_entity_id: targetId,
        type: RELATION_TYPE.OwnedBy,
        data: { arm },
      });
    }
  }

  return relations;
}

/**
 * Extract `actor.staffed_by` -> Team.
 *
 * A scenario step names an actor directly, or names an operation whose `initiated_by` does. Both
 * already reach an Actor in the graph; this edge carries the answer the rest of the way, to the team
 * that performs the step.
 */
export function extractStaffingRelations(
  entities: Entity[],
  placeholders: Map<string, Entity>
): Relation[] {
  const relations: Relation[] = [];

  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Actor) continue;
    const ref = (entity.data as Record<string, unknown> | undefined)?.staffed_by;
    if (typeof ref !== 'string' || ref === '') continue;

    const targetId = resolveTypedOrPlaceholder(ref, ENTITY_TYPE.Team, entity, entities, placeholders);
    relations.push({
      id: `${entity.id}--${RELATION_TYPE.StaffedBy}--${targetId}`,
      source_entity_id: entity.id,
      target_entity_id: targetId,
      type: RELATION_TYPE.StaffedBy,
    });
  }

  return relations;
}
