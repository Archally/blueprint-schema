import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inquiryPinAmbiguous } from './inquiry-pin-ambiguous.mjs';

const INQUIRY_ID = 'delivery-motivation.yaml-delivery.INQ002';
const inquiry = (affects) => ({ id: INQUIRY_ID, displayId: 'delivery.INQ002', type: 'Inquiry', data: { id: 'delivery.INQ002', affects } });
const PROCESSES = [
  { id: 'delivery-story.yaml-delivery.PRC001', displayId: 'delivery.PRC001', type: 'Process', data: {} },
  { id: 'delivery-story.yaml-delivery.PRC002', displayId: 'delivery.PRC002', type: 'Process', data: {} },
];
const placeholder = (ref, candidates) => ({
  id: `missing-${ref.replace(/[^a-zA-Z0-9]/g, '-')}`,
  displayId: ref,
  type: 'Missing',
  data: candidates ? { unresolvedRef: ref, ambiguous: true, candidates } : { unresolvedRef: ref },
});
const pin = (target) => ({ id: `${INQUIRY_ID}--inquiry_affects--${target.id}`, source: INQUIRY_ID, target: target.id, type: 'inquiry_affects' });

const AMBIGUOUS = placeholder('delivery.PA004', PROCESSES.map((process) => process.id));
const MISSING = placeholder('IR999');

test('an element ref drawn to an ambiguous placeholder is reported, naming the declaring elements', () => {
  const model = { entities: [...PROCESSES, AMBIGUOUS], relations: [pin(AMBIGUOUS)] };
  assert.deepEqual(inquiryPinAmbiguous(model, inquiry({ element_refs: ['delivery.PA004'] })), {
    ok: false,
    context: { ids: 'delivery.PA004', candidates: 'delivery.PRC001, delivery.PRC002' },
  });
});

test('silent for an id nobody declares: that is a cross-reference error, not an ambiguity', () => {
  const model = { entities: [MISSING], relations: [pin(MISSING)] };
  assert.deepEqual(inquiryPinAmbiguous(model, inquiry({ element_refs: ['IR999'] })), { ok: true });
});

test('silent for an ambiguous id a kind list also names: it is that list\'s pin', () => {
  const model = { entities: [...PROCESSES, AMBIGUOUS], relations: [pin(AMBIGUOUS)] };
  assert.deepEqual(inquiryPinAmbiguous(model, inquiry({ element_refs: ['delivery.PA004'], process_activity_refs: ['delivery.PA004'] })), { ok: true });
});

test('silent for a placeholder another inquiry draws', () => {
  const model = { entities: [...PROCESSES, AMBIGUOUS], relations: [{ ...pin(AMBIGUOUS), source: 'other' }] };
  assert.deepEqual(inquiryPinAmbiguous(model, inquiry({ element_refs: ['delivery.PA004'] })), { ok: true });
});

test('silent for an inquiry with no element_refs and for an entity that is not an inquiry', () => {
  assert.deepEqual(inquiryPinAmbiguous({ entities: [], relations: [] }, inquiry({ concept_refs: ['delivery.CN001'] })), { ok: true });
  assert.deepEqual(inquiryPinAmbiguous({ entities: [], relations: [] }, { type: 'Risk', data: { affects: { element_refs: ['PA004'] } } }), { ok: true });
});
