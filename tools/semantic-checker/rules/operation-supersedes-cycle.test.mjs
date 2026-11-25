import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { stringify } from 'yaml';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';
import { operationSupersedesCycle } from './operation-supersedes-cycle.mjs';
import { loadSchemaRegistry, makeAjv, SCHEMA_BASE_URI } from '../validator/core/schema-registry.mjs';
import { validateModelTexts } from '../validator/core/validate.mjs';

const { registry } = loadSchemaRegistry(fileURLToPath(new URL('../../v2.8/', import.meta.url)));
const ajv = makeAjv(registry);
const validate = ajv.getSchema(SCHEMA_BASE_URI + 'design/domain.schema.yaml');
const operation = (id, supersedes, kind = 'command') => ({ id, name: id, kind, ...(supersedes === undefined ? {} : { supersedes }) });
const domain = (operations) => ({ name: 'billing', version: '1.0.0', operations });
const oldQuery = { ...operation('billing.QRY001', undefined, 'query'), exchange: { protocol: 'grpc', method: { name: 'GetInvoice' } } };
const successors = {
  getInvoice: { ...operation('invoicing.QRY010', ['billing.QRY001'], 'query'), exchange: { protocol: 'http', endpoint: { method: 'GET', path: '/invoices/{id}' } } },
  issueInvoice: operation('invoicing.CMD010', ['billing.CMD001']),
  issueAndSend: operation('invoicing.CMD012', ['billing.CMD001', 'billing.CMD002']),
};
const migration = {
  migration: { id: 'MIG001', name: 'serve-invoices', description: 'Serve invoices over HTTP.', date: '2026-11-19', status: 'applied' },
  changes: { entities: [
    ...Object.values(successors).map((after) => ({ kind: 'add', entity_type: 'operation', target: after.id, after })),
    { kind: 'remove', entity_type: 'operation', target: oldQuery.id, before: oldQuery },
    { kind: 'deprecate', entity_type: 'operation', target: 'billing.CMD002' },
  ] },
};
function run({ after = successors, history = migration } = {}) {
  const files = [
    { relFile: 'blueprint.yaml', text: stringify({ version: '1.0.0', name: 'Generic shop' }) },
    { relFile: 'billing/domain.yaml', text: stringify(domain({ issueInvoice: operation('billing.CMD001'), sendInvoice: operation('billing.CMD002') })) },
    { relFile: 'invoicing/domain.yaml', text: stringify({ ...domain(after), name: 'invoicing' }) },
  ];
  if (history) files.push({ relFile: '.migrations/001-serve-invoices.migration.yaml', text: stringify(history) });
  return validateModelTexts({ model: '/synthetic', registry, compat: false, files });
}

test('P1-P6: all four replacements validate, including an applied removal retained only in before data', () => {
  const result = run();
  assert.deepEqual(result.schemaErrors, []);
  assert.deepEqual(result.crossErrors, []);
  assert.equal(Object.values(successors).flatMap((entry) => entry.supersedes).length, 4);
});
test('optional, empty, all operation kinds and domain:key lists are schema-valid', () => {
  for (const kind of ['command', 'query', 'event', 'document']) {
    for (const supersedes of [undefined, [], ['billing:issueInvoice'], ['billing.CMD001', 'billing.EVT001', 'billing.QRY001', 'billing.DOC001']]) {
      assert.equal(validate(domain({ successor: operation('billing.CMD010', supersedes, kind) })), true, JSON.stringify(validate.errors));
    }
  }
});
test('domain:key references resolve through the record-wide validator walk', () => {
  const result = run({ after: { successor: operation('invoicing.CMD010', ['billing:issueInvoice']) } });
  assert.deepEqual(result.schemaErrors, []);
  assert.deepEqual(result.crossErrors, []);
});
test('a scalar supersedes value fails schema validation', () => {
  assert.equal(validate(domain({ successor: operation('billing.CMD010', 'billing.CMD001') })), false);
  assert.ok(validate.errors.some((error) => error.keyword === 'type'));
});
test('N1: an id recorded nowhere produces one missing-reference error', () => {
  const result = run({ after: { missing: operation('invoicing.CMD010', ['billing.QRY099']) } });
  assert.deepEqual(result.schemaErrors, []);
  assert.equal(result.crossErrors.length, 1);
  assert.match(result.crossErrors[0], /Missing reference 'billing.QRY099'.*supersedes\[0\]/);
});
test('N2: a non-operation id fails operation_ref schema validation', () => {
  assert.equal(validate(domain({ invalid: operation('billing.CMD010', ['DC001']) })), false);
  assert.ok(validate.errors.some((error) => error.keyword === 'pattern'));
});
test('N3: duplicate ids fail uniqueItems schema validation', () => {
  assert.equal(validate(domain({ duplicate: operation('billing.CMD010', ['billing.CMD001', 'billing.CMD001']) })), false);
  assert.ok(validate.errors.some((error) => error.keyword === 'uniqueItems'));
});
test('N5: removing every old-query record makes the retained successor reference fail', () => {
  const result = run({ history: null });
  assert.deepEqual(result.schemaErrors, []);
  assert.equal(result.crossErrors.length, 1);
  assert.match(result.crossErrors[0], /Missing reference 'billing.QRY001'.*supersedes\[0\]/);
});
const entity = (id, supersedes, extra = {}) => ({ id: `node-${id}`, displayId: id, name: id, type: 'Operation',
  fileOrigin: 'billing/domain.yaml', data: { id, supersedes, ...extra } });
const findings = (model) => model.entities.map((subject) => operationSupersedesCycle(model, subject)).filter((result) => !result.ok);

test('N4: a two-operation cycle warns once, from its lowest declared id, without needing graph edges', () => {
  const model = { entities: [entity('invoicing.CMD010', ['billing.CMD001']), entity('billing.CMD001', ['invoicing.CMD010'])], relations: [] };
  assert.deepEqual(findings(model), [{ ok: false, context: { cycle: 'billing.CMD001 -> invoicing.CMD010 -> billing.CMD001' } }]);
  assert.deepEqual(findings({ ...model, entities: [...model.entities].reverse() }), findings(model));
});
test('self-replacement and disjoint cycles each warn, while acyclic predecessors remain silent', () => {
  const model = { entities: [entity('billing.CMD001', ['billing.CMD001']),
    entity('billing.CMD002', ['billing.CMD003']), entity('billing.CMD003', ['billing.CMD002']),
    entity('billing.CMD004', ['billing.CMD002']), entity('billing.CMD005', ['billing.QRY099'])], relations: [] };
  assert.deepEqual(findings(model).map((result) => result.context.cycle), [
    'billing.CMD001 -> billing.CMD001', 'billing.CMD002 -> billing.CMD003 -> billing.CMD002',
  ]);
});
test('resolves domain:key self-replacement and ignores malformed lists and ambiguous ids', () => {
  const self = entity('billing.CMD001', ['billing:issueInvoice'], { _operation_key: 'issueInvoice' });
  assert.equal(findings({ entities: [self], relations: [] }).length, 1);
  const duplicate = { ...self, id: 'duplicate' };
  assert.deepEqual(findings({ entities: [self, duplicate, entity('billing.CMD002', 'billing.CMD002')], relations: [] }), []);
});
test('kept replacements and cross-kind succession are valid, without invented reciprocal links', () => {
  const model = { entities: [entity('billing.CMD001', []), entity('billing.EVT001', ['billing.CMD001']), entity('billing.DOC001', ['billing.EVT001'])], relations: [] };
  assert.deepEqual(findings(model), []);
});
test('warn registration and project off/error overrides work through the checker', async () => {
  const rules = (await loadRules(dirname(fileURLToPath(import.meta.url)))).filter((rule) => rule.id === 'operation-supersedes-cycle');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].severity, 'warn');
  const extensions = await loadExtensions(rules);
  const model = { entities: [entity('billing.CMD001', ['billing.CMD001'])], relations: [] };
  assert.equal(runChecker(model, rules, {}, extensions)[0].severity, 'warn');
  assert.deepEqual(runChecker(model, rules, { rules: { 'operation-supersedes-cycle': 'off' } }, extensions), []);
  assert.equal(runChecker(model, rules, { rules: { 'operation-supersedes-cycle': 'error' } }, extensions)[0].severity, 'error');
});
test('a long acyclic replacement chain does not exhaust the call stack', () => {
  const entities = Array.from({ length: 10000 }, (_, index) => entity(`billing.CMD${String(index).padStart(5, '0')}`, index === 9999 ? [] : [`billing.CMD${String(index + 1).padStart(5, '0')}`]));
  assert.deepEqual(findings({ entities, relations: [] }), []);
});

// Exercise the real extraction/build/adapter boundary.
async function historicalCycleModel(historicalReferences, currentReferences, { currentId = 'billing.CMD001', removedId = 'billing.CMD002' } = {}) {
  const { buildBlueprintModel } = await import('@blueprint-viewer/core');
  const { loadFromMap } = await import('@blueprint-viewer/core/browser');
  const { toCheckableModel } = await import('@archally/cli-shared');
  const history = {
    migration: { id: 'MIG001', name: 'retire-old-operation', description: 'Retire the old operation.', date: '2026-11-19', status: 'applied' },
    changes: { entities: [{ kind: 'remove', entity_type: 'operation', target: removedId,
      before: operation(removedId, historicalReferences) }] },
  };
  const files = new Map([
    ['blueprint.yaml', stringify({ version: '1.0.0', name: 'Generic shop' })],
    ['billing/domain.yaml', stringify(domain({ current: operation(currentId, currentReferences) }))],
    ['.migrations/001-retire-old-operation.migration.yaml', stringify(history)],
  ]);
  const validation = validateModelTexts({ model: '/synthetic', registry, compat: false,
    files: [...files].map(([relFile, text]) => ({ relFile, text })) });
  assert.deepEqual(validation.schemaErrors, []);
  assert.deepEqual(validation.crossErrors, []);
  const built = buildBlueprintModel(loadFromMap(files).documentsByType);
  assert.deepEqual(built.entities.filter((entry) => entry.type === 'Operation').map((entry) => entry.displayId), [currentId]);
  assert.equal(built.entities.some((entry) => entry.displayId === removedId), false);
  assert.equal(built.relations.some((entry) => entry.type === 'operation_supersedes'), false);
  return toCheckableModel(built);
}
async function historicalCycleFindings(model) {
  const rules = (await loadRules(dirname(fileURLToPath(import.meta.url))))
    .filter((rule) => rule.id === 'operation-supersedes-cycle');
  return runChecker(model, rules, {}, await loadExtensions(rules));
}

test('F1: current A -> removed B -> A warns from retained before data', async () => {
  const model = await historicalCycleModel(['billing.CMD001'], ['billing.CMD002']);
  const issues = await historicalCycleFindings(model);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /billing.CMD001 -> billing.CMD002 -> billing.CMD001/);
});
test('F1: a historical-only self-reference warns from retained before data', async () => {
  const model = await historicalCycleModel(['billing.CMD002'], []);
  const issues = await historicalCycleFindings(model);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /billing.CMD002 -> billing.CMD002/);
});

test('attaches a mixed cycle to its migration when the lowest operation exists only in history', async () => {
  const model = await historicalCycleModel(['billing.CMD009'], ['billing.CMD001'], {
    currentId: 'billing.CMD009', removedId: 'billing.CMD001',
  });
  const issues = await historicalCycleFindings(model);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /billing.CMD001 -> billing.CMD009 -> billing.CMD001/);
});
test('resolves a historical outgoing domain:key reference to a current operation', async () => {
  const model = await historicalCycleModel(['billing:current'], ['billing.CMD002']);
  assert.equal((await historicalCycleFindings(model)).length, 1);
});
test('an acyclic retained predecessor produces no cycle warning', async () => {
  const model = await historicalCycleModel([], ['billing.CMD002']);
  assert.deepEqual(await historicalCycleFindings(model), []);
});
test('uses the current operation body when history also retains that declared id', () => {
  const model = { entities: [entity('billing.CMD001', []), {
    id: 'migration', type: 'Migration', data: { _removed_operations: [
      { id: 'billing.CMD001', supersedes: ['billing.CMD001'] },
    ] },
  }], relations: [] };
  assert.deepEqual(findings(model), []);
});
test('does not resolve a historical reference by adding or removing an id prefix', () => {
  for (const reference of ['CMD001', 'other.CMD001']) {
    const model = { entities: [entity('billing.CMD001', ['billing.CMD002']), {
      id: 'migration', type: 'Migration', data: { _removed_operations: [
        { id: 'billing.CMD002', supersedes: [reference] },
      ] },
    }], relations: [] };
    assert.deepEqual(findings(model), []);
  }
});
test('names each disjoint historical cycle once when both belong to one migration', () => {
  const model = { entities: [{ id: 'migration', type: 'Migration', data: { _removed_operations: [
    { id: 'billing.CMD001', supersedes: ['billing.CMD001'] },
    { id: 'billing.CMD002', supersedes: ['billing.CMD002'] },
  ] } }], relations: [] };
  assert.deepEqual(findings(model), [{ ok: false, context: {
    cycle: 'billing.CMD001 -> billing.CMD001; billing.CMD002 -> billing.CMD002',
  } }]);
});
