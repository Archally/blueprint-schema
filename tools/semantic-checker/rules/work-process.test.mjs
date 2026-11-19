import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneTeamDiffersFromStaffing, activityInTwoLanes, workActivityWithoutLane, activityToolPartyNotSystem, activityItemKeyRepeated, gateOnFailNotASuccessor } from './work-process.mjs';

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

test('reports a question or gate key repeated within one activity, never the same key in two lists or two activities', () => {
  const clean = process({ activities: [
    { id: 'delivery.PA001', questions: [{ key: 'audience' }], gates: [{ key: 'audience' }] },
    { id: 'delivery.PA002', questions: [{ key: 'audience' }] },
  ] });
  assert.equal(activityItemKeyRepeated(model, clean).ok, true);
  const repeated = activityItemKeyRepeated(model, process({ activities: [
    { id: 'delivery.PA001', gates: [{ key: 'release' }, { key: 'release' }, { key: 'a11y' }] },
  ] }));
  assert.equal(repeated.ok, false);
  assert.match(repeated.context.problems, /delivery.PA001: gates key "release"/);
  assert.doesNotMatch(repeated.context.problems, /a11y/);
});

test('reports an on_fail that is not a successor, reading the derived order first and the authored links without it', () => {
  const stated = (gates) => process({ activities: [
    { id: 'delivery.PA001', next: [{ to: 'delivery.PA002' }], next_activities: undefined, gates },
    { id: 'delivery.PA002' },
  ] });
  assert.equal(gateOnFailNotASuccessor(model, stated([{ key: 'ok', on_fail: 'delivery.PA002' }, { key: 'none' }])).ok, true);
  const wrong = gateOnFailNotASuccessor(model, stated([{ key: 'release', on_fail: 'delivery.PA009' }]));
  assert.equal(wrong.ok, false);
  assert.match(wrong.context.problems, /delivery.PA001\/release: on_fail delivery.PA009/);
  const derived = process({ activities: [{ id: 'delivery.PA001', _next: [{ to: 'delivery.PA003', origin: 'declared-order' }],
    next: [{ to: 'delivery.PA002' }], gates: [{ key: 'release', on_fail: 'delivery.PA002' }] }] });
  assert.equal(gateOnFailNotASuccessor(model, derived).ok, false);
  const legacy = process({ activities: [{ id: 'delivery.PA001', next_activities: ['delivery.PA002'], gates: [{ key: 'release', on_fail: 'delivery.PA002' }] }] });
  assert.equal(gateOnFailNotASuccessor(model, legacy).ok, true);
});
