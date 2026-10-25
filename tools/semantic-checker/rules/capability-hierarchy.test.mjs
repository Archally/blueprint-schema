import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityIndex, ancestorsOf, descendantsOf } from './capability-hierarchy.mjs';
import { capabilityRealizedNowhere } from './capability-realized-nowhere.mjs';
import { operationRealizesTwoCapabilities } from './operation-realizes-two-capabilities.mjs';
import { capabilityNestedDeeperThanTwoLevels } from './capability-nested-deeper-than-two-levels.mjs';
function fixture(realized = ['CAP003'], clone = false) {
  const fourth = { id: 'CAP004', name: 'Fourth', level: 4 };
  const third = { id: 'CAP003', name: 'Third', level: 3, children: [fourth] };
  const second = { id: 'CAP002', name: 'Second', level: 2, children: [third] };
  const first = { id: 'CAP001', name: 'First', level: 1, children: [second] };
  return { entities: [...[first, second, third, fourth].map(data => ({
    id: data.id, type: 'Capability', fileOrigin: 'capability.yaml', data: clone ? structuredClone(data) : data,
  })), { id: 'CMD001', type: 'Operation' }], relations: realized.map(source => ({ source, target: 'CMD001', type: 'capability_operation', data: { origin: 'operation' } })) };
}
test('realization reads only L1 and direct children, including copied data', () => {
  for (const clone of [false, true]) {
    const model = fixture(['CAP003'], clone);
    const index = capabilityIndex(model);
    assert.deepEqual([...descendantsOf(index, 'CAP001')], ['CAP002']);
    assert.deepEqual([...descendantsOf(index, 'CAP002')], []);
    assert.deepEqual([...ancestorsOf(index, 'CAP003')], []);
    assert.deepEqual(model.entities.slice(0, 4).map(c => capabilityRealizedNowhere(model, c).ok), [false, true, true, false]);
  }
});
test('empty deeper declarations are judged independently of empty L1 and L2', () => {
  const model = fixture([]);
  assert.deepEqual(model.entities.slice(0, 4).filter(c => !capabilityRealizedNowhere(model, c).ok).map(c => c.id), ['CAP001', 'CAP003', 'CAP004']);
});
test('only the direct L1/L2 pair is excluded from overlap', () => {
  for (const [realized, ok] of [[['CAP001', 'CAP002'], true], [['CAP001', 'CAP003'], false], [['CAP002', 'CAP003'], false]]) {
    const model = fixture(realized);
    assert.equal(operationRealizesTwoCapabilities(model, model.entities[4]).ok, ok);
  }
});
test('each deeper declaration names its parent and L1 regardless of stated level', () => {
  const model = fixture();
  model.entities[2].data.level = 1;
  const findings = model.entities.slice(0, 4).map(c => capabilityNestedDeeperThanTwoLevels(model, c)).filter(r => !r.ok);
  assert.deepEqual(findings.map(r => [r.context.capability, r.context.parent, r.context.root]), [['CAP003', 'CAP002', 'CAP001'], ['CAP004', 'CAP003', 'CAP001']]);
});
test('duplicate-id cycles terminate without crediting deeper operations to L1', () => {
  const model = fixture();
  model.entities[3].data.children = [model.entities[1].data];
  assert.equal(capabilityRealizedNowhere(model, model.entities[0]).ok, false);
  assert.equal(capabilityIndex(model).deeper.size, 2);
});
