// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { extractBlocks } from './extract.mjs';

const guide = readFileSync(new URL('../../docs/modeling-guide.md', import.meta.url), 'utf8');
const { blocks } = extractBlocks(guide);
const documents = blocks.map(block => ({ path: block.path, data: parse(block.body) }));
const concepts = documents.flatMap(document => document.data.concepts ?? []);

// Expectations come from the business contracts, never from the snippet stereotypes.
function concept(identifier, name) {
  const matches = concepts.filter(candidate => candidate.id === identifier);
  assert.equal(matches.length, 1, `${identifier} (${name}) must be extracted exactly once`);
  assert.equal(matches[0].name, name);
  return matches[0];
}

test('all four cases are named model snippets with distinct paths and a root', () => {
  assert.equal(new Set(blocks.map(block => block.path)).size, blocks.length);
  const root = documents.find(document => document.path === '.blueprint/blueprint.yaml');
  assert.ok(root, 'the combined example needs a root');
  assert.deepEqual(root.data.layout.slices, ['checkout', 'orders', 'billing', 'crm']);
  for (const scope of ['orders', 'billing', 'crm']) {
    const document = documents.find(entry => entry.path === `.blueprint/${scope}/concepts.yaml`);
    assert.ok(document, `${scope} must be named, not silently skipped`);
    assert.equal(document.data.scope, scope);
  }
  concept('orders.CN002', 'OrderLine');
  concept('orders.CN003', 'Money');
  concept('billing.CN001', 'Invoice');
  concept('crm.CN001', 'Customer');
  concept('billing.CN002', 'Customer');
});

test('OrderLine is a child Entity owned by the Order consistency boundary', () => {
  const order = concept('orders.CN001', 'Order');
  const orderLine = concept('orders.CN002', 'OrderLine');
  assert.equal(order.stereotype, 'aggregate-root');
  assert.equal(orderLine.stereotype, 'entity');
  assert.equal(orderLine.identity, 'Line number within its Order');
  assert.ok(order.relationships.some(relationship =>
    relationship.predicate === 'contains' && relationship.object === 'orders.CN002' // OrderLine
  ));
});

test('Money has value semantics despite its dedicated implementation type', () => {
  const money = concept('orders.CN003', 'Money');
  assert.equal(money.stereotype, 'value-object');
});

test('Invoice owns its lifecycle and issue consistency boundary', () => {
  const invoice = concept('billing.CN001', 'Invoice');
  assert.equal(invoice.stereotype, 'aggregate-root');
  assert.equal(invoice.identity, 'Invoice number');
});

test('CRM and Billing Customers remain separate roots with explicit correlation', () => {
  const relationshipCustomer = concept('crm.CN001', 'Customer');
  const accountCustomer = concept('billing.CN002', 'Customer');
  assert.equal(relationshipCustomer.stereotype, 'aggregate-root');
  assert.equal(accountCustomer.stereotype, 'aggregate-root');
  assert.equal(relationshipCustomer.identity, 'CRM relationship number');
  assert.equal(accountCustomer.identity, 'Billing account number');
  assert.notEqual(relationshipCustomer.id, accountCustomer.id);
  const associations = documents.flatMap(document => document.data.associations ?? []);
  assert.ok(associations.some(association =>
    association.predicate === 'correlates-with' &&
    association.subject === 'crm.CN001' && // Customer in CRM
    association.object === 'billing.CN002' // Customer in Billing
  ), 'Customer identity translation must be explicit');
});
