import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityKind } from './capability-kind.mjs';

function fixture(roots, { clone = false } = {}) {
  const entities = [];
  function add(data) {
    entities.push({ id: `file-${data.id}-${entities.length}`, type: 'Capability', fileOrigin: 'shop/capability.yaml', data });
    for (const child of data.children ?? []) if (child && typeof child === 'object') add(child);
  }
  roots.forEach(add);
  if (clone) for (const entity of entities) entity.data = structuredClone(entity.data);
  return { entities, relations: [] };
}
const node = (id, extra = {}) => ({ id: `shop.CAP${String(id).padStart(3, '0')}`, name: `Capability ${id}`, level: 1, ...extra });
const results = model => model.entities.map(subject => capabilityKind(model, subject));

test('omitted kind and explicit capability parents accept leaf features without inferring from level or tags', () => {
  for (const kind of [undefined, 'capability']) for (const children of [undefined, []]) {
    const model = fixture([node(1, { ...(kind ? { kind } : {}), children: [node(2, { tags: ['feature'], children: [node(3, { kind: 'feature', children })] })] })]);
    assert.ok(results(model).every(result => result.ok));
    assert.equal(Object.hasOwn(model.entities[1].data, 'kind'), false);
  }
});

test('root feature is rejected even when its level says it has a parent', () => {
  const model = fixture([node(1, { kind: 'feature', level: 3 })]);
  const result = results(model)[0];
  assert.equal(result.ok, false);
  assert.equal(result.context.capability, 'shop.CAP001');
  assert.match(result.context.violations, /shop\/capability.yaml:capabilities\[0\].*immediate capability parent/);
});

test('feature-under-feature and nonempty feature children are reported at their own paths', () => {
  const model = fixture([node(1, { children: [node(2, { kind: 'feature', children: [node(3, { kind: 'feature' }), node(4)] })] })]);
  const findings = results(model);
  assert.deepEqual(findings.map(result => result.ok), [true, false, false, true]);
  assert.match(findings[1].context.violations, /capabilities\[0\].children\[0\].*must be a leaf/);
  assert.match(findings[2].context.violations, /children\[0\].children\[0\].*shop.CAP002.*kind feature/);
});

test('all eleven supported declaration levels are inspected, including copied data', () => {
  for (const clone of [false, true]) {
    let tree = node(11, { kind: 'feature' });
    for (let id = 10; id >= 1; id--) tree = node(id, { children: [tree] });
    const valid = fixture([tree], { clone });
    assert.ok(results(valid).every(result => result.ok));
    tree.children[0].children[0].children[0].children[0].children[0].children[0].children[0].children[0].children[0].kind = 'feature';
    const invalid = fixture([tree], { clone });
    assert.deepEqual(results(invalid).map(result => result.ok), [true, true, true, true, true, true, true, true, true, false, false]);
  }
});

test('duplicate scoped declarations retain separate root and nesting paths rather than picking one parent', () => {
  const model = fixture([node(1, { kind: 'feature' }), node(2, { children: [node(1, { kind: 'feature' })] }), node(3, { kind: 'feature', children: [node(1, { kind: 'feature' })] })]);
  const findings = results(model);
  assert.deepEqual(findings.map(result => result.ok), [false, true, true, false, false]);
  assert.match(findings[4].context.violations, /capabilities\[2\].children\[0\]/);
  assert.match(findings[0].context.violations, /capabilities\[0\]/);
});

test('malformed object cycles terminate and a feature still reports nonempty children', () => {
  const first = node(1, { kind: 'feature' });
  first.children = [first];
  const subject = { id: 'cycle', type: 'Capability', fileOrigin: 'capability.yaml', data: first };
  const result = capabilityKind({ entities: [subject], relations: [] }, subject);
  assert.equal(result.ok, false);
  assert.match(result.context.violations, /must be a leaf/);
});

test('same ids in different files do not supply a parent to a root feature', () => {
  const model = fixture([node(1, { children: [node(2)] })]);
  const subject = { id: 'other', type: 'Capability', fileOrigin: 'other/capability.yaml', data: node(2, { kind: 'feature' }) };
  model.entities.push(subject);
  assert.equal(capabilityKind(model, subject).ok, false);
});

test('copied ambiguous declarations report every candidate and occurrence path', () => {
  const model = fixture([node(1, { kind: 'feature', children: [node(2, { kind: 'feature' })] }), node(3, { children: [node(2, { kind: 'feature' })] })], { clone: true });
  const findings = results(model);
  assert.deepEqual(findings.map(result => result.ok), [false, false, true, false]);
  for (const position of [1, 3]) {
    assert.match(findings[position].context.violations, /capabilities\[0\].children\[0\]/);
    assert.match(findings[position].context.violations, /ambiguous declaration/);
  }
});

test('an ambiguous copied child cannot hide a root feature carrying the same declaration id', () => {
  const model = fixture([node(1, { kind: 'feature' }), node(2, { children: [node(1, { kind: 'feature' })] })], { clone: true });
  const findings = results(model);
  assert.deepEqual(findings.map(result => result.ok), [false, true, false]);
  assert.match(findings[0].context.violations, /ambiguous declaration/);
});
