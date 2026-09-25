import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { completionsFor, fieldAtCursor, prefixOf, prefixesForField, type IdEntry } from './completion';

/**
 * Entries taken from the committed ecommerce model, so the ids and names are the real ones the
 * stage demo will show rather than invented fixtures.
 */
const ENTRIES: IdEntry[] = [
  { id: 'checkout.CMD001', name: 'Add to Cart', kind: 'command', file: 'checkout/domain.yaml' },
  { id: 'checkout.QRY001', name: 'Get Cart', kind: 'query', file: 'checkout/domain.yaml' },
  { id: 'checkout.EVT001', name: 'Item Added to Cart', kind: 'event', file: 'checkout/domain.yaml' },
  { id: 'storefront.SCR001', name: 'Shop the catalog', kind: '', file: 'storefront/interactions.yaml' },
  { id: 'storefront.SCR002', name: "Who's shopping?", kind: '', file: 'storefront/interactions.yaml' },
  { id: 'storefront.UAC001', name: 'Register / sign in', kind: '', file: 'storefront/interactions.yaml' },
  { id: 'orders.CMD001', name: 'Submit Order', kind: 'command', file: 'orders/domain.yaml' },
];

const lines = (s: string): string[] => s.split('\n');

// ── where is the cursor ──────────────────────────────────────────────────────────────────────────

test('a sequence item resolves to the key that owns it', () => {
  const src = lines(['actions:', '  - id: storefront.UAC005', '    triggers_operations:', '      - '].join('\n'));
  const at = fieldAtCursor(src, 3, 8);
  assert.equal(at?.field, 'triggers_operations');
  assert.equal(at?.typed, '');
});

test('a key with a value in progress reports the fragment typed so far', () => {
  const src = lines('    screen: stor');
  const at = fieldAtCursor(src, 0, 16);
  assert.equal(at?.field, 'screen');
  assert.equal(at?.typed, 'stor');
  assert.equal(at?.start, 12);
});

test('a scoped id counts as one fragment, so the dot is replaced not appended', () => {
  const src = lines('    screen: storefront.SCR');
  const at = fieldAtCursor(src, 0, 26);
  assert.equal(at?.typed, 'storefront.SCR');
});

test('a comment never completes', () => {
  assert.equal(fieldAtCursor(lines('    # screen: stor'), 0, 18), undefined);
});

test('the key itself is not a value position', () => {
  assert.equal(fieldAtCursor(lines('    screen: stor'), 0, 6), undefined);
});

// ── which field accepts which id ─────────────────────────────────────────────────────────────────

test('the generated table is derived from the schema, not guessed', () => {
  assert.deepEqual([...(prefixesForField('triggers_operations') ?? [])].sort(), ['CMD', 'DOC', 'EVT', 'QRY']);
  assert.deepEqual([...(prefixesForField('screen') ?? [])], ['SCR']);
});

test('a field that holds no reference offers nothing', () => {
  assert.equal(prefixesForField('description'), undefined);
  assert.equal(completionsFor('description', ENTRIES).length, 0);
});

test('id declares rather than references, so it never completes', () => {
  assert.equal(completionsFor('id', ENTRIES).length, 0);
});

test('a name used as a declaration container anywhere is withheld everywhere', () => {
  // `actions:` is a list of ui_action_ref in test-cases.yaml and a list of action OBJECTS in
  // interactions.yaml. Offering ids where the author is declaring one is worse than silence.
  assert.equal(completionsFor('actions', ENTRIES).length, 0);
  assert.equal(completionsFor('navigation', ENTRIES).length, 0);
});

test('prefixOf reads the prefix through an optional scope', () => {
  assert.equal(prefixOf('orders.CMD001'), 'CMD');
  assert.equal(prefixOf('MIG003'), 'MIG');
  assert.equal(prefixOf('not-an-id'), undefined);
});

// ── what the author is offered ───────────────────────────────────────────────────────────────────

test('an operation field offers operations and nothing else', () => {
  const ids = completionsFor('triggers_operations', ENTRIES).map((r) => r.id);
  assert.deepEqual(
    ids.slice().sort(),
    ['checkout.CMD001', 'checkout.EVT001', 'checkout.QRY001', 'orders.CMD001'],
  );
  assert.ok(!ids.includes('storefront.SCR001'), 'a screen is not an operation');
  assert.ok(!ids.includes('storefront.UAC001'), 'a ui action is not an operation');
});

test('a screen field offers screens only', () => {
  assert.deepEqual(completionsFor('screen', ENTRIES).map((r) => r.id), ['storefront.SCR001', 'storefront.SCR002']);
});

/**
 * THE DEMO. A person types part of a NAME and the right id appears with the name beside it.
 *
 * VS Code filters candidates against `filterText`, so the name has to lead: a label of
 * `checkout.CMD001` does not match `add` at all, and a filterText of `checkout.CMD001 Add to Cart`
 * matches only as a weak scattered hit. Leading with the name makes it a prefix match, which is the
 * strongest score the editor awards and therefore the top row.
 */
test('typing part of a name finds the id, as a prefix match', () => {
  const rows = completionsFor('triggers_operations', ENTRIES);
  const cart = rows.find((r) => r.id === 'checkout.CMD001');
  assert.ok(cart, 'the Add to Cart command is offered');
  assert.equal(cart.name, 'Add to Cart', 'the name travels to the row, for display beside the id');
  assert.ok(
    cart.filterText.toLowerCase().startsWith('add'),
    `typing "add" must prefix-match filterText, got ${JSON.stringify(cart.filterText)}`,
  );
  assert.ok(cart.filterText.includes('checkout.CMD001'), 'the id stays searchable too');

  const submit = rows.find((r) => r.id === 'orders.CMD001');
  assert.ok(submit?.filterText.toLowerCase().startsWith('subm'), 'typing "subm" finds Submit Order');
});

test('rows are ordered by name, so the list reads as names rather than numbers', () => {
  const names = completionsFor('triggers_operations', ENTRIES).slice()
    .sort((a, b) => a.sortText.localeCompare(b.sortText))
    .map((r) => r.name);
  assert.deepEqual(names, ['Add to Cart', 'Get Cart', 'Item Added to Cart', 'Submit Order']);
});

test('an entry with no name still completes, by id', () => {
  const rows = completionsFor('screen', [{ id: 'storefront.SCR009', name: '', kind: '', file: 'f.yaml' }]);
  assert.equal(rows[0].filterText, 'storefront.SCR009');
});
