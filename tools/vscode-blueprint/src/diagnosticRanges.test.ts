import { expect, it } from 'vitest';
import { parseSource, sourceRange } from './diagnosticRanges';

it.each([
  ['block / comment', 'items:\n  - id: WI001 # WI001\n    name: WI001', ['items', 0, 'id'], 'value', 'WI001'],
  ['flow quoted', 'items: [{id: "WI001"}]', ['items', 0, 'id'], 'value', 'WI001'],
  ['single quotes', "items: [{id: 'WI001'}]", ['items', 0, 'id'], 'value', 'WI001'],
  ['CRLF / Unicode', 'name: 😀\r\nitems: [{id: WI001}]', ['items', 0, 'id'], 'value', 'WI001'],
  ['dotted map key', 'refs: {"shop.CMD001": {}}', ['refs', 'shop.CMD001'], 'key', 'shop.CMD001'],
  ['numeric mapping key', 'refs: {123: MS999}', ['refs', '123'], 'value', 'MS999'],
  ['nested lists', 'items: [[MS999]]', ['items', 0, 0], 'value', 'MS999'],
  ['x-model-id / anchor', 'item: {x-model-id: &identity WI001}', ['item', 'x-model-id'], 'value', 'WI001'],
  ['alias value', 'first: &identity WI001\nsecond: *identity', ['second'], 'value', '*identity'],
  ['alias ancestor', 'first: &entity {id: WI001}\nsecond: *entity', ['second', 'id'], 'value', '*entity'],
] as const)('selects only the authored token: %s', (_name, text, path, target, expected) => {
  const source = parseSource(text);
  const range = sourceRange(source, { relFile: 'a.b[0].yaml', path: [...path], target });
  expect(range).toBeDefined();
  expect(text.slice(...range!)).toBe(expected);
});
it('does not locate tokens in a document with parser errors', () => {
  expect(sourceRange(parseSource('items: [{id: WI001}'), { relFile: 'a', path: ['items', 0, 'id'], target: 'value' })).toBeUndefined();
});
