import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

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
