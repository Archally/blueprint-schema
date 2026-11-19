// @ts-check
// The prefix reader behind the id-field table: which typed id prefixes a metamodel reference def
// accepts. Run with `node --test gen-id-fields.test.mjs`; importing the generator writes nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { prefixesForDef, prefixesFromPattern, referenceFields } from './gen-id-fields.mjs';

const sorted = (values) => [...values].sort();

describe('prefixesFromPattern', () => {
  test('reads an alternation behind the optional scope group', () => {
    assert.deepEqual(prefixesFromPattern('^([a-z][a-z0-9-]*\\.)?(CMD|EVT|QRY|DOC)\\d{3,}$'), ['CMD', 'EVT', 'QRY', 'DOC']);
  });

  test('reads a single literal prefix with no scope group', () => {
    assert.deepEqual(prefixesFromPattern('^DMN\\d{3,}$'), ['DMN']);
  });

  test('a pattern with no id prefix yields nothing', () => {
    assert.deepEqual(prefixesFromPattern('^[a-z][a-z0-9-]*$'), []);
  });
});

describe('prefixesForDef', () => {
  const defs = {
    domain_ref: { type: 'string', pattern: '^DMN\\d{3,}$' },
    capability_realization_ref: {
      oneOf: [
        { $ref: '#/$defs/domain_ref' },
        { type: 'string', pattern: '^([a-z][a-z0-9-]*\\.)?BC\\d{3,}$' },
      ],
    },
    bounded_context_ref: {
      anyOf: [
        { type: 'string', pattern: '^([a-z][a-z0-9-]*\\.)?BC\\d{3,}$' },
        { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
      ],
    },
    loop_a: { oneOf: [{ $ref: '#/$defs/loop_b' }, { pattern: '^AAA\\d{3}$' }] },
    loop_b: { oneOf: [{ $ref: '#/$defs/loop_a' }, { pattern: '^BBB\\d{3}$' }] },
  };

  test('a union whose one arm is a local $ref reads both arms', () => {
    assert.deepEqual(sorted(prefixesForDef(defs.capability_realization_ref, defs)), ['BC', 'DMN']);
  });

  test('without the $defs to follow, only the direct arm is read', () => {
    assert.deepEqual(prefixesForDef(defs.capability_realization_ref), ['BC']);
  });

  test('an existing anyOf union with a non-id arm keeps its one prefix', () => {
    assert.deepEqual(prefixesForDef(defs.bounded_context_ref, defs), ['BC']);
  });

  test('defs that reach each other terminate and read every pattern once', () => {
    assert.deepEqual(sorted(prefixesForDef(defs.loop_a, defs)), ['AAA', 'BBB']);
  });

  test('a $ref to a def that does not exist yields nothing', () => {
    assert.deepEqual(prefixesForDef({ $ref: '#/$defs/absent_ref' }, defs), []);
  });
});

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const schema = path => parse(readFileSync(new URL('../../../schemas/blueprint/v2.8/schema/' + path, import.meta.url), 'utf8'));

test('discovers both actual imports arms and retains capability product references', () => {
  const defs = schema('metamodel.schema.yaml').$defs;
  const refs = new Map(Object.entries(defs).filter(([name]) => name.endsWith('_ref')).map(([name, def]) => [name, prefixesForDef(def, defs)]));
  const fields = referenceFields([schema('design/arch.schema.yaml'), schema('governance/capability.schema.yaml')], refs);
  assert.deepEqual(sorted(fields.get('imports') ?? []), ['PKG', 'SVC']);
  assert.deepEqual(sorted(fields.get('products') ?? []), ['PDT']);
  assert.deepEqual(sorted(fields.get('owner') ?? []), ['ACT', 'TM']);
});

test('preserves oneOf discovery, deduplicates nested unions and withholds declarations', () => {
  const reference = { $ref: '../metamodel.schema.yaml#/$defs/service_ref' };
  const root = { properties: {
    refs: { oneOf: [reference, { type: 'array', items: { anyOf: [reference, reference] } }] },
    containers: { anyOf: [reference, { items: { $ref: '#/$defs/entity' } }] },
    id: reference,
  }, $defs: { entity: { properties: { id: reference } } } };
  const fields = referenceFields([root], new Map([['service_ref', ['SVC']]]));
  assert.deepEqual(sorted(fields.get('refs') ?? []), ['SVC']);
  assert.equal(fields.has('containers'), false);
  assert.equal(fields.has('id'), false);
});
