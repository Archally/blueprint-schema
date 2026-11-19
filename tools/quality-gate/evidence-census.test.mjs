import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { measureEvidence, share, relationState, evidenceItems } from './evidence-census.mjs';
import { inventoryEvidence, loadEvidenceSchemas } from './evidence-documents.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { locateSchemaRoot } from './structure.mjs';

// Tests ship in both layouts; the public validator keeps its modules under src/.
const validatorDirectory = new URL('../validator/', import.meta.url);
const validatorCore = new URL(existsSync(new URL('src/core/', validatorDirectory)) ? 'src/core/' : 'core/', validatorDirectory);
const { loadSchemaRegistry, makeAjv, SCHEMA_BASE_URI } = await import(new URL('schema-registry.mjs', validatorCore).href);
const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const { root: schemaRoot } = locateSchemaRoot({
  schemaVersion: '2.8.0', modelRoot: toolDirectory, toolDir: toolDirectory, env: {},
});
assert.ok(schemaRoot, 'the test layout must contain the v2.8 schemas');

const scope = {
  project: 'fixture', modelState: 'as-is', schemaVersion: '2.8.0', fileSetIdentity: 'sha256:fixture',
  selection: { slice: null, type: null, family: null, file: null, files: null, entityIds: null },
  evaluatedAt: '2026-11-14T12:00:00Z', exclusions: [],
};
const row = (id, changes = {}) => ({ id, name: `Claim ${id}`, type: 'concept', slice: 'first', carrier: 'capable', evidence: [], ...changes });
const declarations = [
  row('A', { evidence: evidenceItems({ provenance: { evidence: [{ kind: 'codebase-analysis', source: 'src/a.ts' }] } }) }),
  row('B', { type: 'decision', slice: 'second', evidence: evidenceItems({ evidence: [
    { kind: 'documentation', confidence_impact: 'weakens' },
    { kind: 'documentation', source: 'SRC001', confidence_impact: 'invalidates' },
  ] }) }),
  row('C'), row('D', { type: 'user_story', carrier: 'none' }), row('E', { certainty: 'confirmed' }),
];
const relations = [
  row('R1', { type: 'association', family: 'topology', origin: 'declared', evidence: [{ source: 'direct' }] }),
  row('R2', { family: 'topology', origin: 'declared' }),
  row('R3', { family: 'structure', supportingEvidence: [{ source: 'declaring record' }], origin: 'declared' }),
  row('R4', { family: 'traffic', origin: 'derived', witnesses: [{ origin_ref: { path: 'declaration' } }] }),
  row('R5', { family: 'traceability', carrier: 'none' }),
  row('R6', { family: 'unknown', carrier: 'unknown' }),
];
const graphInput = () => ({ contractVersion: 1, scope, entities: [...declarations, row('A-second-instance', { evidence: declarations[0].evidence })], relations });
const measure = (changes = {}) => measureEvidence({ scope, declarations, graphInput: graphInput(), ...changes });

test('integer census keeps raw declarations and graph instances, carriers and dimensions separate', () => {
  const result = measure();
  assert.equal(result.raw.entities.total, 5);
  assert.deepEqual(result.raw.entities.allObjectShare, share(2, 5));
  assert.deepEqual(result.raw.entities.carrierEligibleShare, share(2, 4));
  assert.equal(result.raw.entities.cannotState, 1);
  assert.equal(result.raw.entities.directEvidenceItems, 3);
  assert.equal(result.raw.entities.noItems, 3);
  assert.equal(result.raw.entities.withTraceableSource, 1);
  assert.equal(result.raw.entities.sources.absent, 1);
  assert.equal(result.raw.entities.sources['registered-unavailable'], 1);
  assert.equal(result.raw.entities.weakeningItems, 1);
  assert.equal(result.raw.entities.invalidatingItems, 1);
  assert.equal(result.raw.entities.confirmedWithoutEvidence, 1);
  assert.equal(result.raw.entities.bySlice.length, 2);
  assert.equal(result.graph.entities.total, 6);
  assert.equal(result.graph.entities.withEvidence, 3);
  assert.equal(result.graph.relations.total, 6);
  assert.equal(result.graph.relations.withEvidence, 1);
  assert.deepEqual(result.graph.relations.evidenceStates, Object.fromEntries([
    'own-evidence', 'declared-without-evidence', 'supporting-record-only', 'derived-with-witnesses', 'no-carrier', 'unknown',
  ].map(key => [key, 1])));
  assert.equal(result.validationRuns.V4.status, 'not-checked');
  assert.equal(result.codeReferences.status, 'not-checked');
});

test('zero denominator, graph absence, broken and ambiguous references remain explicit', () => {
  assert.deepEqual(share(0, 0), { numerator: 0, denominator: 0, value: null, label: 'N/A' });
  assert.equal(measureEvidence({ scope, declarations: [] }).graph.status, 'unavailable');
  assert.equal(measure({ sourceRegistry: [] }).raw.entities.sources.broken, 1);
  assert.equal(measure({ sourceRegistry: [{ id: 'SRC001' }, { id: 'SRC001' }] }).raw.entities.sources.ambiguous, 1);
});

test('each own, supporting and witness position changes only its intended census', () => {
  const original = measure();
  for (const index of [0, 1]) {
    const changed = structuredClone(declarations);
    changed[index].evidence.push({ source: 'extra' });
    const result = measure({ declarations: changed });
    assert.equal(result.raw.entities.directEvidenceItems, 4);
    assert.equal(result.graph.relations.withEvidence, original.graph.relations.withEvidence);
  }
  const supported = graphInput();
  supported.relations = structuredClone(relations);
  supported.relations[2].supportingEvidence.push({ source: 'extra supporting record' });
  assert.equal(measure({ graphInput: supported }).graph.relations.directEvidenceItems, 1);
  supported.relations[1].evidence.push({ source: 'own' });
  assert.equal(measure({ graphInput: supported }).graph.relations.withEvidence, 2);
  assert.equal(relationState(row('locator-only', { origin_ref: { path: 'witness' } })), 'unknown');
});

test('serialized graph input round-trips and rejects every mismatched identity dimension', () => {
  assert.deepEqual(measure({ graphInput: JSON.parse(JSON.stringify(graphInput())) }), measure());
  for (const key of ['project', 'schemaVersion', 'modelState', 'fileSetIdentity', 'selection']) {
    const changed = structuredClone(graphInput());
    changed.scope[key] = 'different';
    assert.throws(() => measure({ graphInput: changed }), /mismatch/);
  }
  const duplicate = graphInput();
  duplicate.entities.push(duplicate.entities[0]);
  assert.throws(() => measure({ graphInput: duplicate }), /duplicate/);
});

const root = path.resolve('/private/tmp/evd01-schema-fixture');
const schemas = loadEvidenceSchemas(schemaRoot);
const doc = (file, data) => ({ file: path.join(root, file), doc: data, slice: file.split('/')[0] });
const documents = () => [
  doc('first/concepts.yaml', { version: '1.0.0', concepts: [{ id: 'first.CN001', name: 'Order', provenance: { evidence: [{ kind: 'documentation', source: 'manual', summary: 'Order definition.' }] }, attributes: { total: { id: 'first.CAT001', description: 'Total amount.' } } }] }),
  doc('second/decisions.yaml', { version: '1.0.0', decisions: [{ id: 'second.DC001', title: 'Retain orders', summary: 'Keep orders for review.', date: '2026-11-14', rationale: { problem: 'Orders need review.', chosen: 'Retain them.' }, status: 'proposed', evidence: [{ kind: 'documentation', source: 'policy', summary: 'Retention policy.' }] }] }),
  doc('second/domain.yaml', { name: 'second', version: '1.0.0', operations: { placeOrder: { id: 'second.CMD001', name: 'Place Order', kind: 'command', provenance: {}, exchange: { protocol: 'http', endpoint: { path: '/orders', method: 'POST' }, provenance: { evidence: [{ source: 'route', kind: 'codebase-analysis', summary: 'Route declaration.' }] } } } } }),
];

test('schema traversal inventories nested typed objects and inline link evidence without counting a reference as a declaration', () => {
  const { registry } = loadSchemaRegistry(schemaRoot);
  const ajv = makeAjv(registry);
  for (const document of documents()) {
    const kind = path.basename(document.file).replace('.yaml', '');
    const layer = kind === 'decisions' ? 'governance' : 'design';
    const validate = ajv.compile({ $ref: `${SCHEMA_BASE_URI}${layer}/${kind}.schema.yaml` });
    assert.equal(validate(document.doc), true, JSON.stringify(validate.errors));
  }
  const result = inventoryEvidence(documents(), root, schemas);
  assert.equal(result.entities.length, 4);
  assert.equal(result.entities.filter(record => record.evidence.length > 0).length, 2);
  assert.equal(result.entities.find(record => record.type === 'concept_attribute').carrier, 'none');
  assert.equal(result.entities.find(record => record.type === 'operation').carrier, 'capable');
  assert.equal(result.relations.filter(record => record.type === 'exchange').length, 1);
  assert.equal(result.relations.find(record => record.type === 'exchange').evidence.length, 1);
});

test('mutating each schema evidence position affects its own declaration population only', () => {
  const initial = inventoryEvidence(documents(), root, schemas);
  for (const position of ['nested', 'flat', 'exchange']) {
    const changed = documents();
    const items = position === 'nested' ? changed[0].doc.concepts[0].provenance.evidence
      : position === 'flat' ? changed[1].doc.decisions[0].evidence
        : changed[2].doc.operations.placeOrder.exchange.provenance.evidence;
    items.push({ kind: 'documentation', source: 'extra', summary: 'Additional observation.' });
    const result = inventoryEvidence(changed, root, schemas);
    const sum = rows => rows.reduce((total, record) => total + record.evidence.length, 0);
    assert.equal(sum(result.entities) - sum(initial.entities), position === 'exchange' ? 0 : 1);
    assert.equal(sum(result.relations) - sum(initial.relations), position === 'exchange' ? 1 : 0);
  }
});

test('schema companion capability exists without an entry and evidence joins exact targets only', () => {
  const data = { name: 'services', contexts: [{ id: 'first.BC001', name: 'Sales', services: [
    { id: 'first.SVC001', name: 'Checkout', kind: 'application', uses: ['first.SVC002', 'first.SVC003'],
      link_provenance: { uses: { 'first.SVC002': { evidence: [{ source: 'runtime' }] } } } },
  ] }] };
  const result = inventoryEvidence([doc('first/arch.yaml', data)], root, schemas);
  const links = result.relations.filter(record => record.target?.startsWith('first.SVC'));
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(record => record.carrier), ['capable', 'capable']);
  assert.deepEqual(links.map(record => record.evidence.length), [1, 0]);
});

test('a dictionary entry named provenance remains a declaration and example IDs remain examples', () => {
  const data = documents();
  data[0].doc.concepts[0].attributes.provenance = { id: 'first.CAT002', description: 'Evidence reference.' };
  data.push(doc('first/models.yaml', { version: '1.0.0', components: { schemas: {
    Record: { 'x-model-id': 'first.MDL001', type: 'object', description: 'Record shape.', example: { id: 'first.CN999' } },
  } } }));
  const result = inventoryEvidence(data, root, schemas);
  assert.equal(result.entities.length, 6);
  assert.equal(result.entities.some(row => row.declarationId === 'first.CN999'), false);
  assert.equal(result.entities.some(row => row.declarationId === 'first.CAT002'), true);
});
