import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['org']!;

/**
 * Extract org entities from one org document.
 *
 * Schema shape (nested hierarchy):
 *   parties: [{ id, name, departments: [{ id, name, teams: [team_ref] }], teams: [{ id, name }] }]
 *
 * Produces Party, Department, and Team entities.
 * Departments and teams carry `_party` metadata for hierarchy reconstruction.
 */
export function extractOrg(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const parties = data.parties as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parties)) return entities;

  for (const party of parties) {
    const partyId = party.id as string | undefined;
    const partyName = party.name as string | undefined;
    if (!partyId) continue;

    const displayId = String(partyId);
    const id = makeInternalId(doc.scope, doc.filePath, displayId);
    const partyDescription = party.description as string | undefined;
    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.Party,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: partyName,
      term: partyName,
      description: partyDescription,
      data: party,
    });

    // Departments (nested objects with their own id)
    const departments = party.departments as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(departments)) {
      for (const dept of departments) {
        const deptId = dept.id as string | undefined;
        const deptName = dept.name as string | undefined;
        if (!deptId) continue;

        const deptDisplayId = String(deptId);
        const deptInternalId = makeInternalId(doc.scope, doc.filePath, deptDisplayId);
        const deptDescription = dept.description as string | undefined;
        entities.push({
          id: deptInternalId,
          displayId: deptDisplayId,
          type: ENTITY_TYPE.Department,
          layer: LAYER,
          fileOrigin: doc.filePath,
          summary: deptName,
          term: deptName,
          description: deptDescription,
          data: { ...dept, _party: partyId },
        });
      }
    }

    // Teams (nested objects with their own id)
    const teams = party.teams as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(teams)) {
      for (const team of teams) {
        const teamId = team.id as string | undefined;
        const teamName = team.name as string | undefined;
        if (!teamId) continue;

        const teamDisplayId = String(teamId);
        const teamInternalId = makeInternalId(doc.scope, doc.filePath, teamDisplayId);
        const teamDescription = team.description as string | undefined;
        entities.push({
          id: teamInternalId,
          displayId: teamDisplayId,
          type: ENTITY_TYPE.Team,
          layer: LAYER,
          fileOrigin: doc.filePath,
          summary: teamName,
          term: teamName,
          description: teamDescription,
          data: { ...team, _party: partyId },
        });
      }
    }
  }

  return entities;
}
