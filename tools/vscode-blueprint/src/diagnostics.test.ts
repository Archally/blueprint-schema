import * as path from 'node:path';
import { expect, it } from 'vitest';
import { DiagnosticModel, owningModelRoot, schemaInputs, selectSchema } from './diagnostics';
const inputs = () => schemaInputs(path.resolve(__dirname, '../../../../schemas/blueprint/v2.8'));
const roadmap = (id = 'WI001', milestone = '') => `version: 1.0.0\nwork_items: [{id: ${id}, name: First, kind: epic${milestone ? `, milestone: ${milestone}` : ''}}]\n`;

it('marks every duplicate and links all other declarations in file/line order', () => {
  const model = new DiagnosticModel();
  model.update('z.roadmap.yaml', roadmap());
  model.update('a.roadmap.yml', roadmap());
  model.update('m.roadmap.yaml', roadmap());
  const findings = model.evaluate(inputs());
  expect(findings).toHaveLength(3);
  for (const finding of findings) {
    expect(finding.code).toBe('duplicate-id');
    expect(finding.related).toHaveLength(2);
    expect(finding.related.map((other: any) => other.file)).toEqual(['a.roadmap.yml', 'm.roadmap.yaml', 'z.roadmap.yaml'].filter(file => file !== finding.file));
    expect(finding.message).toContain(':2');
    expect(model.parsed.get(finding.file)!.text.slice(...finding.range)).toBe('WI001');
  }
});
it('recomputes closed sibling references after an unsaved declaration repair without reparsing siblings', () => {
  const model = new DiagnosticModel();
  model.update('delivery.roadmap.yaml', roadmap('WI001', 'MS999'));
  model.update('milestones.roadmap.yaml', 'milestones: []');
  const original = model.parsed.get('delivery.roadmap.yaml');
  expect(model.evaluate(inputs()).map(item => item.code)).toEqual(['dangling-reference']);
  model.update('milestones.roadmap.yaml', 'milestones: [{id: MS999, name: Ready}]');
  expect(model.evaluate(inputs())).toEqual([]);
  expect(model.parsed.get('delivery.roadmap.yaml')).toBe(original);
});
it('suppresses missing-reference cascades until invalid declaration text is repaired', () => {
  const model = new DiagnosticModel();
  model.update('delivery.roadmap.yaml', roadmap('WI001', 'MS999'));
  model.update('other.roadmap.yaml', roadmap());
  model.update('milestones.roadmap.yaml', 'milestones: [');
  expect(model.evaluate(inputs()).map(item => item.code)).toEqual(['duplicate-id', 'duplicate-id']);
  model.update('milestones.roadmap.yaml', 'milestones: []');
  expect(model.evaluate(inputs()).filter(item => item.code === 'dangling-reference')).toHaveLength(1);
});
it('ignores files outside model membership and applies live per-rule severities', () => {
  const model = new DiagnosticModel();
  model.update('notes.yaml', roadmap());
  model.update('delivery.roadmap.yaml', roadmap('WI001', 'MS999'));
  expect(model.evaluate(inputs(), { duplicateSeverity: 'off', danglingSeverity: 'warning' }).map(item => item.severity)).toEqual(['warning']);
  expect(model.evaluate(inputs(), { duplicateSeverity: 'off', danglingSeverity: 'off' })).toEqual([]);
});
it('removes stale duplicate diagnostics on delete and keeps model roots independent', () => {
  const first = new DiagnosticModel();
  const second = new DiagnosticModel();
  first.update('a.roadmap.yaml', roadmap());
  first.update('b.roadmap.yaml', roadmap());
  second.update('a.roadmap.yaml', roadmap());
  expect(first.evaluate(inputs())).toHaveLength(2);
  expect(second.evaluate(inputs())).toEqual([]);
  first.update('b.roadmap.yaml', undefined);
  expect(first.evaluate(inputs())).toEqual([]);
});
it('close of a dirty buffer restores disk declarations and their sibling errors', () => {
  const model = new DiagnosticModel();
  const disk = 'milestones: []';
  model.update('a.roadmap.yaml', roadmap('WI001', 'MS999'));
  model.update('b.roadmap.yaml', 'milestones: [{id: MS999, name: Ready}]');
  expect(model.evaluate(inputs())).toEqual([]);
  model.update('b.roadmap.yaml', disk);
  expect(model.evaluate(inputs())).toHaveLength(1);
});
it.each([
  ['/a/.blueprint/v2.8/a.roadmap.yml', '/a/.blueprint/v2.8'],
  ['/a/.blueprint/v2.7/shop/concepts.yaml', '/a/.blueprint/v2.7'],
  ['/a/rootless.yaml', undefined],
])('finds the nearest version root for %s', (file, expected) => expect(owningModelRoot(file)).toBe(expected));
it.each([
  ['v2.8', '2.4.0', undefined, 'v2.8', true],
  ['v2', '2.4.0', undefined, 'v2.4', false],
  ['v2', undefined, undefined, 'v2', false],
  ['v2.8', '2.4.0', '2.7', 'v2.7', false],
])('selects CLI schema precedence: %s %s %s', (directory, declaration, override, version, conflict) => {
  expect(selectSchema(`/a/.blueprint/${directory}`, declaration, override)).toEqual({ version, conflict });
});
