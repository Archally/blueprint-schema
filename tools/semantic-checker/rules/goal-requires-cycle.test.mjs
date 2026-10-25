import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';
import { goalRequiresCycle } from './goal-requires-cycle.mjs';
import { goalNotAdvanced, DEFAULT_ADVANCED_BY } from './goal-advancers.mjs';
const modelOf = (edges, count = 3) => ({entities: Array.from({length: count}, (_, index) => ({id: `node-${index + 1}`, displayId: `GL00${index + 1}`, type: 'Goal', data: {id: `GL00${index + 1}`}})),
  relations: edges.map(([source, target, type = 'goal_requires']) => ({source: `node-${source}`, target: `node-${target}`, type}))});
const findings = model => model.entities.map(subject => goalRequiresCycle(model, subject)).filter(result => !result.ok);
test('reports one warning per cyclic component with sorted members and deterministic witness', () => {
  const model = modelOf([[3, 1], [1, 3], [2, 1], [1, 2]]);
  assert.deepEqual(findings(model).map(result => result.context), [{members: 'GL001, GL002, GL003', witness: 'GL001 -> GL002 -> GL001'}]);
  const reordered = {...model, entities: [...model.entities].reverse(), relations: [...model.relations].reverse()};
  assert.deepEqual(findings(reordered), findings(model));
  assert.equal(findings(modelOf([[1, 2], [2, 1], [3, 4], [4, 5], [5, 3]], 5)).length, 2);
});
for (const [name, edges] of [
  ['acyclic necessity', [[1, 2], [2, 3]]],
  ['contribution feedback', [[1, 2, 'goal_contributes_to'], [2, 1, 'goal_contributes_to']]],
  ['mixed-kind feedback', [[1, 2], [2, 1, 'goal_contributes_to']]],
  ['self targets handled by reference errors', [[1, 1]]],
]) test(`does not warn for ${name}`, () => assert.deepEqual(findings(modelOf(edges)), []));
test('keeps goal-only support and work advancing A from advancing B', () => {
  const model = modelOf([[1, 2, 'goal_contributes_to']]);
  assert.equal(goalNotAdvanced(model, model.entities[0]).ok, false);
  assert.equal(goalNotAdvanced(model, model.entities[1]).ok, false);
  model.entities.push({id: 'work', type: 'WorkItem', data: {advances_goals: ['GL001']}});
  assert.equal(goalNotAdvanced(model, model.entities[0]).ok, true);
  assert.equal(goalNotAdvanced(model, model.entities[1]).ok, false);
  assert.deepEqual(DEFAULT_ADVANCED_BY, ['capability', 'value_stream', 'leverage_point', 'milestone', 'work_item', 'decision']);
});
test('registers warn severity and respects off and error lint overrides', async () => {
  const pack = await loadRules(dirname(fileURLToPath(import.meta.url)));
  const rules = pack.filter(rule => rule.id === 'goal-requires-cycle');
  assert.equal(rules.length, 1); assert.equal(rules[0].severity, 'warn');
  const extensions = await loadExtensions(rules);
  const model = modelOf([[1, 2], [2, 1]]);
  assert.equal(runChecker(model, rules, {}, extensions)[0].severity, 'warn');
  assert.deepEqual(runChecker(model, rules, {rules: {'goal-requires-cycle': 'off'}}, extensions), []);
  assert.equal(runChecker(model, rules, {rules: {'goal-requires-cycle': 'error'}}, extensions)[0].severity, 'error');
});
test('handles a long necessity chain without recursive stack exhaustion', () => {
  const model = modelOf(Array.from({length: 9999}, (_, index) => [index + 1, index + 2]), 10000);
  assert.deepEqual(findings(model), []);
});
