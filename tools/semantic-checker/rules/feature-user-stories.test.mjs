import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';

const rules = (await loadRules(fileURLToPath(new URL('.', import.meta.url))))
  .filter(rule => rule.id.startsWith('feature-user-stories-'));

test('canonical descriptors load exclusive ownership errors and mismatch warnings', async () => {
  assert.equal(rules.length, 2);
  const story = { id: 'story', type: 'UserStory', data: { id: 'shop.US101', name: 'Capture an order' } };
  const feature = (id, name) => ({ id, type: 'Capability', data: { id, name, kind: 'feature', user_stories: ['shop.US101'] } });
  const model = { entities: [story, feature('shop.CAP101', 'Order capture'), feature('shop.CAP102', 'Order amendment')], relations: [] };
  const issues = runChecker(model, rules, {}, await loadExtensions(rules));
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 1);
  assert.equal(issues.filter(issue => issue.severity === 'warn').length, 2);
  assert.match(issues.find(issue => issue.severity === 'error').message, /shop.US101.*Capture an order/);
  assert.match(issues.find(issue => issue.severity === 'error').message, /shop.CAP101.*Order capture/);
});

const extensions = await loadExtensions(rules);
const story = { id: 'capture-story', type: 'UserStory', displayId: 'shop.US101', data: { id: 'shop.US101', goal: 'Capture an order' } };
const otherStory = { id: 'amend-story', type: 'UserStory', displayId: 'shop.US102', data: { id: 'shop.US102', goal: 'Amend an order' } };
const operation = { id: 'capture-operation', type: 'Operation', data: { id: 'shop.CMD101', name: 'Capture order' } };
function owner(data = {}) {
  return { id: 'capture-feature', type: 'Capability', data: { id: 'shop.CAP101', name: 'Order capture', kind: 'feature', ...data } };
}
function otherOwner(data = {}) {
  return { id: 'amend-feature', type: 'Capability', data: { id: 'shop.CAP102', name: 'Order amendment', kind: 'feature', ...data } };
}
const relation = (source, type, target) => ({ id: `${source.id}--${type}--${target.id}`, source: source.id, type, target: target.id });
function check(entities, relations = []) {
  return runChecker({ entities, relations }, rules, {}, extensions);
}

test('matching stated and operation-derived sets have no diagnostics', () => {
  const feature = owner({ user_stories: [story.data.id] });
  const issues = check([feature, story, operation], [
    relation(story, 'user_story_operation', operation),
    relation(feature, 'capability_operation', operation),
  ]);
  assert.deepEqual(issues, []);
});

test('empty and complete nonempty lists warn in both set-difference directions', () => {
  for (const references of [[], [otherStory.data.id]]) {
    const feature = owner({ user_stories: references });
    const issues = check([feature, story, otherStory, operation], [
      relation(story, 'user_story_operation', operation),
      relation(feature, 'capability_operation', operation),
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warn');
    assert.match(issues[0].message, /operation-derived only: shop.US101 \(Capture an order\)/);
    if (references.length > 0) assert.match(issues[0].message, /stated only: shop.US102 \(Amend an order\)/);
  }
});

test('omitted lists, including ambiguous candidates, are not mismatch warnings', () => {
  const first = owner();
  const second = otherOwner();
  assert.deepEqual(check([first, second, story, operation], [
    relation(story, 'user_story_operation', operation),
    relation(first, 'capability_operation', operation),
    relation(second, 'capability_operation', operation),
  ]), []);
});

test('duplicate list entries are not two-feature ownership', () => {
  const feature = owner({ user_stories: [story.data.id, story.data.id] });
  const issues = check([feature, story]);
  assert.equal(issues.filter(issue => issue.severity === 'error').length, 0);
  assert.equal(issues.filter(issue => issue.severity === 'warn').length, 1);
});

test('unresolved and ambiguous references remain explicit rather than disappearing into set differences', () => {
  const duplicate = { ...story, id: 'another-file-story' };
  const missing = { id: 'shop.US404', name: 'Undeclared order story' };
  const feature = owner({ user_stories: [story.data.id, missing.id] });
  const issues = check([feature, story, duplicate]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'warn');
  assert.match(issues[0].message, /ambiguous story reference shop.US101/);
  assert.match(issues[0].message, /unresolved story reference shop.US404/);
  assert.doesNotMatch(issues[0].message, /stated only:/);
});

test('wrong-type story-shaped targets produce reference evidence but no ownership error', () => {
  const wrongType = { ...story, type: 'Concept' };
  const first = owner({ user_stories: [story.data.id] });
  const second = otherOwner({ user_stories: [story.data.id] });
  const issues = check([first, second, wrongType]);
  assert.equal(issues.length, 2);
  assert.ok(issues.every(issue => issue.severity === 'warn'));
  assert.ok(issues.every(issue => issue.message.includes('no declared UserStory')));
});
