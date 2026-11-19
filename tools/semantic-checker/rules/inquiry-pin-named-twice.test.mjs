import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inquiryPinNamedTwice, KIND_LISTS } from './inquiry-pin-named-twice.mjs';

const inquiry = (affects) => ({ id: 'delivery-motivation.yaml-delivery.INQ002', displayId: 'delivery.INQ002', type: 'Inquiry', data: { id: 'delivery.INQ002', affects } });
const check = (affects) => inquiryPinNamedTwice({ entities: [], relations: [] }, inquiry(affects));

test('an id in element_refs and in its kind list is reported, naming the id and the list', () => {
  assert.deepEqual(check({ element_refs: ['delivery.CN001', 'IR003'], concept_refs: ['delivery.CN001'] }), {
    ok: false,
    context: { ids: 'delivery.CN001', lists: '`concept_refs`' },
  });
});

test('every repeated id and every list it repeats in are named once', () => {
  const result = check({
    element_refs: ['delivery.PA004', 'delivery.CN001', 'CAP001'],
    process_activity_refs: ['delivery.PA004'],
    concept_refs: ['delivery.CN001'],
    capability_refs: ['CAP001'],
  });
  assert.deepEqual(result, { ok: false, context: { ids: 'delivery.PA004, delivery.CN001, CAP001', lists: '`process_activity_refs`, `concept_refs`, `capability_refs`' } });
});

test('every kind list the schema declares beside element_refs is compared', () => {
  for (const list of KIND_LISTS) {
    assert.equal(check({ element_refs: ['X001'], [list]: ['X001'] }).ok, false, list);
  }
});

for (const [what, affects] of [
  ['distinct ids', { element_refs: ['IR003'], concept_refs: ['delivery.CN001'] }],
  ['a scope name equal to nothing typed', { element_refs: ['IR003'], context_refs: ['delivery'] }],
  ['two spellings of different ids', { element_refs: ['CN001'], concept_refs: ['delivery.CN001'] }],
  ['no element_refs', { concept_refs: ['delivery.CN001'] }],
  ['no affects', undefined],
]) {
  test(`silent for ${what}`, () => {
    assert.deepEqual(check(affects), { ok: true });
  });
}
