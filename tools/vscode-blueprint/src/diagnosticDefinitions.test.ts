import { expect, it } from 'vitest';
import { classifyDeclarations, preferredDeclarations } from './declarations';

const root = '/shop/.blueprint/v2.8';
const classify = (text: string, file = 'migration.yaml') => classifyDeclarations(`${root}/${file}`, text);
const identifiers = (text: string, file?: string) => classify(text, file).map(declaration => declaration.id);

it('retains exact block and flow scalar ranges while excluding comments and prose', () => {
  const text = 'concepts:\n  - id: "orders.CN001"\n    description: "id: orders.CN999"\n  - {id: \'orders.CN002\', name: Second}\n# id: orders.CN998';
  const declarations = classify(text, 'concepts.yml');
  expect(declarations.map(declaration => declaration.id)).toEqual(['orders.CN001', 'orders.CN002']);
  expect(declarations[0].start).toEqual({ line: 1, character: 9 });
  expect(declarations[0].end).toEqual({ line: 1, character: 21 });
  expect(declarations[1].start).toEqual({ line: 3, character: 10 });
  expect(declarations[1].end).toEqual({ line: 3, character: 22 });
});

it.each(['migration.yaml', 'migration.yml', '001.migration.yaml', '001.migration.yml', 'migrations.yaml', 'migrations.yml', '.migrations/001.yaml'])(
  'does not infer an introduction from filename %s', file => {
    expect(identifiers('entities: [{id: orders.CN001}]', file)).toEqual([]);
  },
);

it.each(['kind', 'op', 'operation'])('recognizes current new through %s and preserves migration identity', operation => {
  const text = `migration: {id: MIG001}\nchange_set:\n  - ${operation}: new\n    entity: {id: "orders.CN001", kind: concept, name: New order}\n`;
  const declarations = classify(text, 'arbitrary.yaml');
  expect(declarations.map(declaration => [declaration.id, declaration.origin])).toEqual([
    ['MIG001', 'metadata'], ['orders.CN001', 'introduction'],
  ]);
  expect(declarations[1].name).toBe('New order');
});

it('recognizes explicit new payloads in a current change set', () => {
  expect(identifiers('change_set: [{new: {id: orders.CN001}}]', 'any.yaml')).toEqual(['orders.CN001']);
});

it('recognizes legacy add only in the entity after payload', () => {
  const text = 'changes:\n  entities:\n    - kind: add\n      id: orders.CN999\n      before: {id: orders.CN998}\n      after: {id: orders.CN001, properties: {id: orders.CN997}}\n  properties:\n    - kind: add\n      after: {id: orders.CN996}\n';
  expect(identifiers(text, 'arbitrary.yml')).toEqual(['orders.CN001']);
});

it.each(['split', 'modify', 'remove', 'merge', 'rename', 'deprecate', 'unknown'])(
  'treats %s payload IDs as references in both formats', operation => {
    expect(identifiers(`changes: {entities: [{kind: ${operation}, before: {id: orders.CN001}, after: [{id: orders.CN002}]}]}`)).toEqual([]);
    expect(identifiers(`change_set: [{kind: ${operation}, before: {id: orders.CN001}, after: {id: orders.CN002}}]`)).toEqual([]);
  },
);

it('does not declare historical payloads within a new operation', () => {
  expect(identifiers('change_set: [{kind: new, before: {id: orders.CN999}, references: [{id: orders.CN998}], after: {id: orders.CN001, properties: {id: orders.CN997}}}]')).toEqual(['orders.CN001']);
});

it.each([false, true])('selects layer declarations per root independent of file order (reverse %s)', reverse => {
  const candidates = [
    { origin: 'introduction' as const, modelRoot: root, file: 'migration.yaml' },
    { origin: 'layer' as const, modelRoot: root, file: 'a.yaml' },
    { origin: 'layer' as const, modelRoot: root, file: 'b.yaml' },
    { origin: 'introduction' as const, modelRoot: '/other/.blueprint/v2.8', file: 'foreign.yaml' },
    { origin: 'introduction' as const, modelRoot: '/shop/.blueprint/v2.7', file: 'older.yaml' },
  ];
  if (reverse) candidates.reverse();
  expect(preferredDeclarations(candidates).map(declaration => declaration.file).sort()).toEqual(['a.yaml', 'b.yaml', 'foreign.yaml', 'older.yaml']);
});

it('preserves metadata and multiple migration-only introductions', () => {
  const candidates = [
    { origin: 'metadata' as const, modelRoot: root },
    { origin: 'introduction' as const, modelRoot: root },
    { origin: 'introduction' as const, modelRoot: root },
  ];
  expect(preferredDeclarations(candidates)).toEqual(candidates);
});

it('does not invent declarations from invalid YAML or aliases', () => {
  expect(classify('concepts: [{id: orders.CN001}', 'concepts.yaml')).toEqual([]);
  expect(identifiers('concepts: [&entity {id: orders.CN001}, *entity]', 'concepts.yaml')).toEqual(['orders.CN001']);
});
