import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotspotStatementEmpty } from './hotspot-statement-empty.mjs';

for (const type of ['Inquiry', 'Risk', 'Finding']) {
  for (const [label, statement, ok] of [
    ['empty', '', false],
    ['spaces', '   ', false],
    ['tabs and newlines', '\t\n', false],
    ['valid', ' Investigate retry ownership. ', true],
    ['missing', undefined, true],
    ['number', 42, true],
    ['null', null, true],
    ['object', {}, true],
    ['boolean', false, true],
  ]) {
    test(`${type} treats ${label} statement independently of display text`, () => {
      const data = { summary: 'Readable summary', description: 'Readable description' };
      if (statement !== undefined) {
        data.statement = statement;
      }
      assert.deepEqual(hotspotStatementEmpty({}, { type, data }), { ok });
    });
  }
}

for (const type of ['Question', 'Goal', 'Concept', undefined]) {
  test(`ignores blank statement on ${type}`, () => {
    assert.deepEqual(hotspotStatementEmpty({}, { type, data: { statement: '' } }), { ok: true });
  });
}
