import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inquiryPassedOnWithoutAddressee } from './inquiry-passed-on-without-addressee.mjs';

const inquiry = (data) => ({ id: `payments-motivation.yaml-${data.id}`, displayId: data.id, type: 'Inquiry', data });
const check = (data) => inquiryPassedOnWithoutAddressee({ entities: [], relations: [] }, inquiry(data));

const REDIRECTED = [{ asked_of: { actor: 'payments.ACT004' }, outcome: 'redirected' }];

test('an open inquiry passed on with no current addressee is reported, naming whom it was last asked of', () => {
  assert.deepEqual(check({ id: 'INQ105', status: 'open', owner: 'TM001', previously_asked_of: REDIRECTED }), {
    ok: false,
    context: { earlier: 'payments.ACT004' },
  });
});

test('the last of several earlier addressees is named, by name where it has no reference', () => {
  const result = check({
    id: 'INQ108',
    status: 'investigating',
    previously_asked_of: [...REDIRECTED, { asked_of: { name: 'Support desk' }, outcome: 'redirected' }],
  });
  assert.deepEqual(result, { ok: false, context: { earlier: '"Support desk", the last of 2 earlier addressees' } });
});

test('a reference beside a name is named with both', () => {
  const result = check({ id: 'INQ109', previously_asked_of: [{ asked_of: { team: 'TM002', name: 'Support' }, outcome: 'reassigned' }] });
  assert.deepEqual(result, { ok: false, context: { earlier: 'TM002 ("Support")' } });
});

test('an inquiry with no status is unsettled and is reported', () => {
  assert.equal(check({ id: 'INQ110', previously_asked_of: REDIRECTED }).ok, false);
});

test('a deferred inquiry is unsettled and is reported', () => {
  assert.equal(check({ id: 'INQ111', status: 'deferred', previously_asked_of: REDIRECTED }).ok, false);
});

for (const [what, data] of [
  ['a current addressee by reference', { id: 'INQ101', status: 'investigating', asked_of: { team: 'TM003' }, previously_asked_of: REDIRECTED }],
  ['a current addressee by name', { id: 'INQ102', status: 'open', asked_of: { name: 'Domain expert' }, previously_asked_of: REDIRECTED }],
  ['no earlier addressee and no addressee', { id: 'INQ104', status: 'open' }],
  ['an empty history', { id: 'INQ104', status: 'open', previously_asked_of: [] }],
  ['an owner and no addressee, never inferred from it', { id: 'INQ106', status: 'deferred', owner: 'TM001' }],
  ['a resolved inquiry', { id: 'INQ112', status: 'resolved', resolution: 'Seven years.', previously_asked_of: REDIRECTED }],
  ['a closed inquiry', { id: 'INQ113', status: 'closed', resolution: 'Seven years.', previously_asked_of: REDIRECTED }],
]) {
  test(`silent for ${what}`, () => {
    assert.deepEqual(check(data), { ok: true });
  });
}

test('silent for an entity that is not an inquiry', () => {
  assert.deepEqual(inquiryPassedOnWithoutAddressee({}, { type: 'Risk', data: { previously_asked_of: REDIRECTED } }), { ok: true });
});
