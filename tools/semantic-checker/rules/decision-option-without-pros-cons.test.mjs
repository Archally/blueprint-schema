import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionOptionWithoutProsCons } from './decision-option-without-pros-cons.mjs';

for (const retirement of [
  { status: 'deprecated' },
  { status: 'superseded' },
  { links: { superseded_by: ['example.DC002'] } },
]) {
  test(`does not read rationale for ${JSON.stringify(retirement)}`, () => {
    const decision = {
      ...retirement,
      get rationale() {
        throw new Error('Retired rationale must not be examined');
      },
    };
    assert.deepEqual(decisionOptionWithoutProsCons({}, { data: decision }), { ok: true });
  });
}

test('reports malformed option values without crashing or inventing names', () => {
  const subject = {
    data: {
      id: 'example.DC001',
      name: 'Choose a module',
      rationale: { options: [null, 1, { name: ' ' }] },
    },
  };
  const result = decisionOptionWithoutProsCons({}, subject);
  assert.equal(result.ok, false);
  assert.equal(result.context.incomplete_options, 'A (unnamed option), B (unnamed option), C (unnamed option)');
});
