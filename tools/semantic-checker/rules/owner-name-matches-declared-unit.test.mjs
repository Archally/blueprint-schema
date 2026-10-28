import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerNameMatchesDeclaredUnit, normaliseOwnerName } from './owner-name-matches-declared-unit.mjs';

const unit = (type, id, name, extra = {}) => ({ id: `org-${id}`, displayId: id, type, fileOrigin: 'organization.yaml', data: { id, name, ...extra } });
const owned = (id, data, fileOrigin = 'arch.yaml', type = 'Context') => ({ id: `${fileOrigin}-${id}`, displayId: id, type, fileOrigin, data });

function run(entities) {
  const model = { entities, relations: [] };
  return entities
    .map((subject) => ({ subject: subject.displayId, result: ownerNameMatchesDeclaredUnit(model, subject) }))
    .filter(({ result }) => !result.ok);
}

const ORG = [
  unit('Team', 'TM001', 'Payments'),
  unit('Team', 'TM002', 'Shared Services'),
  unit('Department', 'DPT001', 'Shared services'),
  unit('Party', 'PRT001', 'Acme'),
  unit('Team', 'TM003', 'Payments'), // a second team that shares TM001's name
];

test('one match names the unit and the reference to write', () => {
  const findings = run([unit('Team', 'TM001', 'Payments'), owned('Billing', { owned_by: { name: 'Payments' } })]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].subject, 'Billing');
  assert.equal(findings[0].result.context.statement, 'Context Billing');
  assert.equal(findings[0].result.context.ownerName, 'Payments');
  assert.match(findings[0].result.context.match, /team TM001 \("Payments"\): write owned_by: \{ team: TM001 \}/);
});

test('case and whitespace variants match; nothing fuzzier does', () => {
  const findings = run([
    unit('Party', 'PRT001', 'Acme  Corp'),
    owned('A', { owned_by: { name: '  acme corp ' } }),
    owned('B', { owned_by: { name: 'ACME\tCORP' } }),
    owned('C', { owned_by: { name: 'Acme Corporation' } }),
    owned('D', { owned_by: { name: 'AcmeCorp' } }),
  ]);
  assert.deepEqual(findings.map((finding) => finding.subject), ['A', 'B']);
  assert.match(findings[0].result.context.match, /party PRT001 .*owned_by: \{ party: PRT001 \}/);
});

test('several matches are listed as ambiguous, across arms', () => {
  const findings = run([...ORG.slice(0, 3), owned('Ops', { owned_by: { name: 'shared services' } })]);
  assert.equal(findings.length, 1);
  const { match } = findings[0].result.context;
  assert.match(match, /^matches 2 declared units, department DPT001 \("Shared services"\), team TM002 \("Shared Services"\): write the reference to the one meant\.$/);
});

test('one unit declared twice with one id is one candidate, not an ambiguity', () => {
  const findings = run([unit('Team', 'TM001', 'Payments'), { ...unit('Team', 'TM001', 'Payments'), id: 'other-TM001' }, owned('Billing', { owned_by: { name: 'Payments' } })]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].result.context.match, /^matches the declared team TM001/);
});

test('a name that matches nothing is silent', () => {
  assert.deepEqual(run([...ORG, owned('Billing', { owned_by: { name: 'The team for invoices' } })]), []);
});

test('a name beside a reference is silent, even when it matches another unit', () => {
  assert.deepEqual(run([...ORG, owned('Billing', { owned_by: { team: 'TM002', name: 'Payments' } })]), []);
});

test('a unit declared without an id is no candidate', () => {
  assert.deepEqual(run([{ id: 'arch-Acme', displayId: 'Acme', type: 'Party', fileOrigin: 'arch.yaml', data: { name: 'Acme' } }, owned('X', { owned_by: { name: 'Acme' } })]), []);
});

test('a file default inherited by three entities is reported once, on the first by id', () => {
  const statement = { name: 'Payments' };
  const findings = run([
    unit('Team', 'TM001', 'Payments'),
    owned('Zeta', { _owned_by_default: statement }, 'billing/arch.yaml'),
    owned('Alpha', { _owned_by_default: statement }, 'billing/arch.yaml'),
    owned('Mid', { _owned_by_default: statement }, 'billing/arch.yaml'),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].subject, 'Alpha');
  assert.equal(findings[0].result.context.statement, 'The file-level owned_by of billing/arch.yaml, inherited by 3 entities,');
});

test('an entity stating its own owner is not counted as inheriting the default', () => {
  const findings = run([
    unit('Team', 'TM001', 'Payments'),
    owned('A', { _owned_by_default: { name: 'Payments' } }, 'billing/arch.yaml'),
    owned('B', { owned_by: { team: 'TM001' } }, 'billing/arch.yaml'),
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].result.context.statement, /inherited by 1 entity,$/);
});

test('one owned_by object carried by two entities is one statement', () => {
  const shared = { name: 'Payments' };
  const findings = run([unit('Team', 'TM001', 'Payments'), owned('A', { owned_by: shared }), owned('B', { owned_by: shared }, 'arch.yaml', 'Service')]);
  assert.equal(findings.length, 1);
});

test('normaliseOwnerName collapses whitespace and case', () => {
  assert.equal(normaliseOwnerName('  The Team  for\nPayments '), 'the team for payments');
});
