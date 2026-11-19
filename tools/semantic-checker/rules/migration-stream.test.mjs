// Firing and clean fixtures for the three migration rules in migration-stream.mjs.
//
//   node --test schemas/blueprint/.shared/semantic-rules/migration-stream.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  migrationWithoutTeamOwner,
  migrationReachDisagrees,
  migrationDependencyReasonUnlisted,
} from './migration-stream.mjs';

const migration = (data) => ({ id: 'migrations.yaml-MIG002', displayId: 'MIG002', type: 'Migration', data: { id: 'MIG002', ...data } });
const item = (id, provenance) => ({ id, provenance, sources: [] });

describe('migration-without-team-owner', () => {
  test('fires once for a migration with no owner', () => {
    const result = migrationWithoutTeamOwner({}, migration({}));
    assert.equal(result.ok, false);
    assert.match(result.context.finding, /names no owner/);
  });

  test('fires for a department or a party as owner', () => {
    assert.match(migrationWithoutTeamOwner({}, migration({ owned_by: { department: 'DPT001' } })).context.finding, /department \(DPT001\)/);
    assert.match(migrationWithoutTeamOwner({}, migration({ owned_by: { party: 'PRT001' } })).context.finding, /party \(PRT001\)/);
  });

  test('is clean for a team owner, a team beside a name, and a name alone', () => {
    assert.deepEqual(migrationWithoutTeamOwner({}, migration({ owned_by: { team: 'TM001' } })), { ok: true });
    assert.deepEqual(migrationWithoutTeamOwner({}, migration({ owned_by: { team: 'TM001', name: 'Team A' } })), { ok: true });
    assert.deepEqual(migrationWithoutTeamOwner({}, migration({ owned_by: { name: 'The order team' } })), { ok: true });
  });

  test('ignores every other entity type', () => {
    assert.deepEqual(migrationWithoutTeamOwner({}, { type: 'Decision', data: {} }), { ok: true });
  });
});

describe('migration-reach-disagrees', () => {
  const reach = (extra) => ({ _reach: { declared: true, derivation: 'complete', not_derived: 0, contexts: [], domains: [], ...extra } });

  test('fires for a derived context the statement leaves out', () => {
    const result = migrationReachDisagrees({}, migration(reach({ contexts: [item('BC001', 'both'), item('BC002', 'derived')] })));
    assert.equal(result.ok, false);
    assert.match(result.context.finding, /its changes reach BC002, which `reach` does not state/);
  });

  test('fires for a stated domain the changes never reach when every change was traced', () => {
    const result = migrationReachDisagrees({}, migration(reach({ domains: [item('DMN002', 'declared')] })));
    assert.match(result.context.finding, /`reach` states DMN002, which none of its changes reach/);
  });

  test('does not report an unconfirmed statement while a change is untraced, and counts it', () => {
    assert.deepEqual(migrationReachDisagrees({}, migration(reach({ derivation: 'partial', not_derived: 1, contexts: [item('BC009', 'declared')] }))), { ok: true });
    const mixed = migrationReachDisagrees({}, migration(reach({ derivation: 'partial', not_derived: 2, contexts: [item('BC001', 'derived'), item('BC009', 'declared')] })));
    assert.match(mixed.context.finding, /reach BC001.*2 change\(s\) could not be traced/);
    assert.doesNotMatch(mixed.context.finding, /BC009/);
  });

  test('is clean when the statement and the changes agree, and when nothing is stated', () => {
    assert.deepEqual(migrationReachDisagrees({}, migration(reach({ contexts: [item('BC001', 'both')], domains: [item('DMN001', 'both')] }))), { ok: true });
    assert.deepEqual(migrationReachDisagrees({}, migration({ _reach: { declared: false, derivation: 'complete', contexts: [item('BC001', 'derived')], domains: [] } })), { ok: true });
    assert.deepEqual(migrationReachDisagrees({}, migration({})), { ok: true });
  });
});

describe('migration-dependency-reason-unlisted', () => {
  test('fires for a reason naming a migration depends_on does not list', () => {
    const result = migrationDependencyReasonUnlisted({}, migration({ depends_on: ['MIG001'], depends_on_reasons: [{ migration: 'MIG003', reason: 'Why.' }] }));
    assert.match(result.context.finding, /waiting for MIG003, which `depends_on` does not list/);
  });

  test('fires for a second reason for one dependency', () => {
    const result = migrationDependencyReasonUnlisted({}, migration({ depends_on: ['MIG001'], depends_on_reasons: [{ migration: 'MIG001', reason: 'One.' }, { migration: 'MIG001', reason: 'Two.' }] }));
    assert.match(result.context.finding, /second reason for MIG001/);
  });

  test('is clean for one reason per listed dependency, for a dependency without a reason, and with no reasons', () => {
    assert.deepEqual(migrationDependencyReasonUnlisted({}, migration({ depends_on: ['MIG001', 'MIG000'], depends_on_reasons: [{ migration: 'MIG001', reason: 'Why.' }] })), { ok: true });
    assert.deepEqual(migrationDependencyReasonUnlisted({}, migration({ depends_on: ['MIG001'] })), { ok: true });
  });
});
