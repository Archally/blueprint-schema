import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { leveragePointMigrationBackReference } from './leverage-point-migration-back-reference.mjs';
import { loadSchemaRegistry, makeAjv, SCHEMA_BASE_URI } from '../validator/core/schema-registry.mjs';
import { validateModelTexts } from '../validator/core/validate.mjs';
import { indexModelDeclarations, trackedRegisterFindings } from '../validator/core/tracked-register.mjs';

const { registry } = loadSchemaRegistry(fileURLToPath(new URL('../../v2.8/', import.meta.url)));
const ajv = makeAjv(registry);
const documentOf = (refs) => ({
  migration: { id: 'MIG001', name: 'split-reporting', description: 'Split reporting reads.', date: '2026-11-19', status: 'pending', ...(refs === undefined ? {} : { leverage_refs: refs }) },
  changes: { entities: [{ kind: 'modify', entity_type: 'concept', target: 'CN001', before: { id: 'CN001' }, after: { id: 'CN001' } }] },
});
const registerOf = (refs) => ({ migrations: [{ id: 'MIG002', name: 'Reporting read model', status: 'completed', changes: [{ type: 'add', description: 'A read model serves reports.' }], ...(refs === undefined ? {} : { leverage_refs: refs }) }] });
const trackedOf = (refs) => [{ id: 'MIG001', name: 'retry-payments', status: 'draft', change_set: [], ...(refs === undefined ? {} : { leverage_refs: refs }) }];
const leverage = { version: '1.0.0', leverage_points: [
  { id: 'LP001', title: 'Isolate reporting reads', one_thing: 'Reports stop slowing checkout.', migration_refs: ['MIG002', 'MIG001'] },
  { id: 'LP002', title: 'Retry payments safely', one_thing: 'A retry never charges twice.' },
  { id: 'LP003', title: 'Name one owner', one_thing: 'Each context has one team.', migration_refs: ['MIG001'] },
] };
const run = (document = documentOf(['LP002', 'LP003']), history = registerOf([]), points = leverage) => validateModelTexts({
  model: '/synthetic', registry, compat: false, files: [
    { relFile: 'blueprint.yaml', text: stringify({ version: '1.0.0', name: 'Generic shop' }) },
    { relFile: '.migrations/001-split-reporting.migration.yaml', text: stringify(document) },
    { relFile: 'migrations.yaml', text: stringify(history) },
    { relFile: 'leverage.yaml', text: stringify(points) },
  ],
});
for (const [shape, make] of [['migration', documentOf], ['migrations', registerOf], ['tracked-migrations', trackedOf]]) {
  const validate = ajv.getSchema(SCHEMA_BASE_URI + `${shape}.schema.yaml`);
  test(`${shape}: omitted, empty and scoped refs validate`, () => {
    for (const refs of [undefined, [], ['LP002', 'platform.LP004']]) assert.equal(validate(make(refs)), true, JSON.stringify(validate.errors));
  });
  test(`${shape}: N2 duplicates and N3 wrong-type/watch refs fail`, () => {
    assert.equal(validate(make(['LP002', 'LP002'])), false);
    assert.ok(validate.errors.some((error) => error.keyword === 'uniqueItems'));
    for (const refs of [['DC001'], ['WCH001']]) {
      assert.equal(validate(make(refs)), false);
      assert.ok(validate.errors.some((error) => error.keyword === 'pattern'));
    }
  });
}
test('P1-P5 mixed input validates; N1 fails the reference walk in both model forms', () => {
  const clean = run();
  assert.deepEqual(clean.schemaErrors, []);
  assert.deepEqual(clean.crossErrors, []);
  for (const [document, history] of [[documentOf(['LP099']), registerOf([])], [documentOf([]), registerOf(['LP099'])]]) {
    const result = run(document, history);
    assert.deepEqual(result.schemaErrors, []);
    assert.equal(result.crossErrors.length, 1);
    assert.match(result.crossErrors[0], /Missing reference 'LP099' at .*leverage_refs\[0\]/);
  }
});
test('N5: an undeclared legacy migration still fails the reference walk', () => {
  const points = structuredClone(leverage);
  points.leverage_points[0].migration_refs = ['MIG099'];
  const result = run(documentOf([]), registerOf([]), points);
  assert.equal(result.crossErrors.length, 1);
  assert.match(result.crossErrors[0], /Missing reference 'MIG099'.*migration_refs\[0\]/);
});
test('P6 and N4: a tracked collision stays separate and a missing LP fails', () => {
  const document = documentOf([]);
  const before = structuredClone(document);
  const index = indexModelDeclarations([{ relFile: 'leverage.yaml', data: leverage }, { relFile: 'migration.yaml', data: document }]);
  assert.deepEqual(trackedRegisterFindings(trackedOf(['LP002']), index, '../migrations.yaml').crossErrors, []);
  const result = trackedRegisterFindings(trackedOf(['LP099']), index, '../migrations.yaml');
  assert.deepEqual(result.crossErrors, ["Missing reference 'LP099' at ../migrations.yaml [0].leverage_refs[0] (tracked migration MIG001)"]);
  assert.deepEqual(document, before);
});
const entity = (id, type) => ({ id, displayId: id, type });
const point = entity('LP001', 'LeveragePoint');
const edge = (source, target, provenance) => ({ source, target, type: 'migration_serves_leverage', data: { provenance } });
const check = (relations, subject = point, entities = [entity('MIG001', 'Migration'), entity('MIG002', 'Migration'), point]) => leveragePointMigrationBackReference({ entities, relations }, subject);
test('P1: a new-only link is silent', () => {
  assert.deepEqual(check([edge('MIG001', 'LP001', 'migration')]), { ok: true });
});
test('P2: equivalent dual asks only to remove the old entry', () => {
  const result = check([edge('MIG001', 'LP001', 'both')]);
  assert.equal(result.context.count, '1');
  assert.deepEqual(result.context.migrations, ['MIG001 - already lists this leverage point in leverage_refs, so the entry here can go']);
});
test('P3-P5: old-only and asymmetric links ask to add first, once per LP', () => {
  const result = check([edge('MIG002', 'LP001', 'leverage-point'), edge('MIG001', 'LP001', 'leverage-point')]);
  assert.equal(result.ok, false);
  assert.equal(result.context.count, '2');
  assert.deepEqual(result.context.migrations, ['MIG002', 'MIG001'].map((id) => `${id} - does NOT list this leverage point, so add it to the migration's leverage_refs first`));
});
test('N5: missing legacy source gives the correction remedy', () => {
  const result = check([edge('MIG099', 'LP001', 'leverage-point')], point, [entity('MIG099', 'Missing'), point]);
  assert.deepEqual(result.context.migrations, ['MIG099 - names no migration the model declares; correct or remove it']);
});
test('migrated links and unrelated subjects are silent', () => {
  const relations = [edge('MIG001', 'LP001', 'migration'), edge('MIG002', 'LP001', 'migration'), edge('MIG001', 'LP002', 'migration'), edge('MIG001', 'LP003', 'migration')];
  for (const id of ['LP001', 'LP002', 'LP003']) assert.deepEqual(check(relations, entity(id, 'LeveragePoint')), { ok: true });
  assert.deepEqual(check(relations, entity('MIG001', 'Migration')), { ok: true });
});
test('the checker reads extracted provenance: two warnings before migration and none after', async () => {
  const { loadRules, loadExtensions, runChecker } = await import('@archally/semantic-checker');
  const { buildBlueprintModel } = await import('@blueprint-viewer/core');
  const { loadFromMap } = await import('@blueprint-viewer/core/browser');
  const { toCheckableModel } = await import('@archally/cli-shared');
  const rules = await loadRules(fileURLToPath(new URL('./leverage-point-migration-back-reference.yaml', import.meta.url)));
  const extensions = await loadExtensions(rules);
  const evaluate = (document, history, points) => {
    const files = new Map([
      ['blueprint.yaml', stringify({ version: '1.0.0', name: 'Generic shop' })],
      ['.migrations/001-split-reporting.migration.yaml', stringify(document)],
      ['migrations.yaml', stringify(history)],
      ['leverage.yaml', stringify(points)],
    ]);
    return runChecker(toCheckableModel(buildBlueprintModel(loadFromMap(files).documentsByType)), rules, {}, extensions);
  };
  const issues = evaluate(documentOf(['LP002', 'LP003']), registerOf([]), leverage);
  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.severity === 'warn'));
  assert.match(issues.map((issue) => issue.message).join(' '), /already lists/);
  assert.match(issues.map((issue) => issue.message).join(' '), /does NOT list/);
  const migratedPoints = structuredClone(leverage);
  for (const item of migratedPoints.leverage_points) delete item.migration_refs;
  assert.deepEqual(evaluate(documentOf(['LP001', 'LP002', 'LP003']), registerOf(['LP001']), migratedPoints), []);
});
