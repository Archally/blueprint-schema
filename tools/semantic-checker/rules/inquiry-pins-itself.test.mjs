import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inquiryPinsItself } from './inquiry-pins-itself.mjs';

const inquiry = (id, affects) => ({ id: `delivery-motivation.yaml-${id}`, displayId: id, type: 'Inquiry', data: { id, affects } });
const check = (id, affects) => inquiryPinsItself({ entities: [], relations: [] }, inquiry(id, affects));

test('an inquiry naming its own id in element_refs is reported', () => {
  assert.deepEqual(check('delivery.INQ002', { element_refs: ['IR003', 'delivery.INQ002'] }), { ok: false });
});

for (const [what, id, affects] of [
  ['another inquiry', 'delivery.INQ002', { element_refs: ['delivery.INQ003'] }],
  ['the unscoped twin of its own id, which is another id', 'delivery.INQ002', { element_refs: ['INQ002'] }],
  ['its own id in a kind list, which takes no inquiry id', 'delivery.INQ002', { concept_refs: ['delivery.INQ002'] }],
  ['no element_refs', 'delivery.INQ002', { concept_refs: ['delivery.CN001'] }],
  ['no affects', 'delivery.INQ002', undefined],
]) {
  test(`silent for ${what}`, () => {
    assert.deepEqual(check(id, affects), { ok: true });
  });
}

test('silent for an entity that is not an inquiry', () => {
  assert.deepEqual(inquiryPinsItself({}, { type: 'Risk', displayId: 'RSK001', data: { affects: { element_refs: ['RSK001'] } } }), { ok: true });
});
