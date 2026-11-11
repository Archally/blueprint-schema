import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneTeamDiffersFromStaffing, activityInTwoLanes, workActivityWithoutLane, activityToolPartyNotSystem } from './work-process.mjs';

const team = { id: 'team-internal', displayId: 'TM001', type: 'Team', data: {} };
const actor = { id: 'actor-internal', displayId: 'delivery.ACT001', type: 'Actor', data: { staffed_by: 'TM001' } };
const operation = { id: 'operation-internal', displayId: 'delivery.CMD001', type: 'Operation', data: {} };
const model = { entities: [team, actor, operation] };
const process = (fields) => ({ data: { describes: 'organization', activities: [{ id: 'delivery.PA001' }], ...fields } });

test('accepts exact scoped references and retains first-step operation and derived actor lane fallbacks', () => {
  assert.equal(workActivityWithoutLane(model, process({ activities: [{ id: 'delivery.PA001', steps: [{ operation_ref: 'delivery.CMD001' }] }], lanes: [{ actor: 'delivery.ACT001', operations: ['delivery.CMD001'] }] })).ok, true);
  assert.equal(workActivityWithoutLane(model, process({ activities: [{ id: 'delivery.PA001', triggered_by: ['delivery.ACT001'] }] })).ok, true);
  assert.equal(laneTeamDiffersFromStaffing(model, process({ lanes: [{ actor: 'delivery.ACT001', team: 'TM001' }] })).ok, true);
});

test('leaves unresolved or ambiguous declarations to validation rather than selecting a short id', () => {
  const ambiguous = { entities: [...model.entities, { ...actor, id: 'other-actor' }] };
  assert.equal(workActivityWithoutLane(ambiguous, process({ activities: [{ id: 'delivery.PA001', triggered_by: ['delivery.ACT001'] }] })).ok, false);
  assert.equal(workActivityWithoutLane(model, process({ activities: [{ id: 'delivery.PA001', triggered_by: ['ACT001'] }] })).ok, false);
  assert.equal(laneTeamDiffersFromStaffing(ambiguous, process({ lanes: [{ actor: 'delivery.ACT001', team: 'TM001' }] })).ok, true);
});

test('does not report foreign activity membership as a duplicate activity of this process', () => {
  assert.equal(activityInTwoLanes(model, process({ lanes: [{ team: 'TM001', activities: ['delivery.PA999'] }, { team: 'TM002', activities: ['delivery.PA999'] }] })).ok, true);
});

test('reports every non-system tool with its activity and item position, without conflating equal suffixes', () => {
  const parties = { entities: [
    { id: 'party-internal', type: 'Party', displayId: 'delivery.PRT001', data: { kind: 'organization' } },
    { id: 'other-party', type: 'Party', displayId: 'shop.PRT001', data: { kind: 'system' } },
  ] };
  const result = activityToolPartyNotSystem(parties, process({ activities: [{ id: 'delivery.PA001', tools: [{ party: 'shop.PRT001' }, { party: 'delivery.PRT001' }, { party: 'delivery.PRT001' }, { party: 'PRT001' }] }] }));
  assert.equal(result.ok, false);
  assert.match(result.context.problems, /tools\[1\].*delivery.PRT001.*tools\[2\]/);
  assert.doesNotMatch(result.context.problems, /tools\[0\]|tools\[3\]/);
});
