import * as path from 'node:path';
import { expect, it } from 'vitest';
import { DiagnosticWorkspace, DEFAULT_DIAGNOSTIC_SETTINGS, type DiagnosticWorkspaceAdapter } from './diagnostics';
function workspace() {
  const root = '/fixture/.blueprint/v2.8';
  const disk = new Map([
    [`${root}/delivery.roadmap.yaml`, 'work_items: [{id: WI001, milestone: MS999}]'],
    [`${root}/milestones.roadmap.yml`, 'milestones: []'],
  ]);
  const overlays = new Map<string, string>();
  const settings = { ...DEFAULT_DIAGNOSTIC_SETTINGS, schemaVersion: '', schemaRoot: '' };
  let reads = 0;
  const adapter: DiagnosticWorkspaceAdapter = {
    files: async () => [...disk.keys()].map(file => ({ file, eligible: file.endsWith('.yaml') })),
    read: async file => { reads++; if (!disk.has(file)) throw Error('deleted'); return disk.get(file)!; },
    overlays: () => new Map(overlays),
    settings: () => settings,
    bundledSchemaRoot: path.resolve(__dirname, '../../../../schemas/blueprint/v2.8'),
  };
  return { root, disk, overlays, settings, adapter, engine: new DiagnosticWorkspace(adapter), reads: () => reads };
}
it('loads closed yml siblings regardless of editor eligibility and overlays inactive dirty text', async () => {
  const fixture = workspace();
  fixture.overlays.set(`${fixture.root}/milestones.roadmap.yml`, 'milestones: [{id: MS999}]');
  const result = await fixture.engine.compute();
  expect(result).toHaveLength(1);
  expect(result[0].diagnostics).toEqual([]);
  fixture.overlays.clear();
  expect((await fixture.engine.compute())[0].diagnostics.map(item => item.code)).toEqual(['dangling-reference']);
});
it('caches disk/CST, invalidates on save and clears deleted files', async () => {
  const fixture = workspace();
  await fixture.engine.compute();
  const reads = fixture.reads();
  fixture.overlays.set(`${fixture.root}/milestones.roadmap.yml`, 'milestones: [{id: MS999}]');
  expect((await fixture.engine.compute())[0].diagnostics).toEqual([]);
  expect(fixture.reads()).toBe(reads);
  fixture.disk.set(`${fixture.root}/milestones.roadmap.yml`, 'milestones: [{id: MS999}]');
  fixture.overlays.clear();
  fixture.engine.invalidate(`${fixture.root}/milestones.roadmap.yml`);
  expect((await fixture.engine.compute())[0].diagnostics).toEqual([]);
  fixture.disk.delete(`${fixture.root}/delivery.roadmap.yaml`);
  fixture.engine.invalidate(`${fixture.root}/delivery.roadmap.yaml`, true);
  expect(await fixture.engine.compute()).toEqual([]);
});
it('reports schema unavailability and version conflicts without silently using latest', async () => {
  const fixture = workspace();
  fixture.settings.schemaRoot = '/missing/schema';
  expect((await fixture.engine.compute())[0].diagnostics[0].code).toBe('schema-unavailable');
  fixture.settings.schemaRoot = '';
  fixture.disk.set(`${fixture.root}/blueprint.yaml`, 'schemaVersion: 2.4.0');
  fixture.engine.invalidate(undefined, true);
  expect((await fixture.engine.compute())[0].diagnostics.map(item => item.code)).toContain('schema-version-conflict');
  fixture.settings.schemaVersion = '2.4';
  expect((await fixture.engine.compute())[0].diagnostics.map(item => item.code)).toEqual(['schema-unavailable']);
});
it('suppresses missing findings on unreadable membership and recovers on repair', async () => {
  const fixture = workspace();
  const read = fixture.adapter.read;
  fixture.adapter.read = async file => { if (file.endsWith('.yml')) throw Error('unreadable'); return read(file); };
  expect((await fixture.engine.compute())[0].diagnostics.filter(item => item.code === 'dangling-reference')).toEqual([]);
  fixture.adapter.read = read;
  fixture.engine.invalidate(undefined, true);
  expect((await fixture.engine.compute())[0].diagnostics.map(item => item.code)).toEqual(['dangling-reference']);
});
it('abandons an older load before it can mutate the latest publication model', async () => {
  const fixture = workspace();
  const read = fixture.adapter.read;
  let release!: (text: string) => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  fixture.adapter.read = file => {
    if (file.endsWith('delivery.roadmap.yaml')) { started(); return new Promise<string>(resolve => { release = resolve; }); }
    return read(file);
  };
  const older = fixture.engine.compute();
  await reading;
  const fresh = 'work_items: [{id: WI002}]';
  fixture.overlays.set(`${fixture.root}/delivery.roadmap.yaml`, fresh);
  const latest = await fixture.engine.compute();
  release('work_items: [{id: WI001, milestone: MS999}]');
  await older;
  expect(latest[0].model.parsed.get('delivery.roadmap.yaml')!.text).toBe(fresh);
  expect(latest[0].diagnostics).toEqual([]);
});

it('publishes an unavailable-schema warning message without an Error prefix', async () => {
  const fixture = workspace();
  fixture.settings.schemaVersion = '2.7';

  const publications = await fixture.engine.compute();

  expect(publications[0].diagnostics[0]).toMatchObject({
    code: 'schema-unavailable', severity: 'warning',
    message: 'Schema v2.7 unavailable. Bundled support: v2.8. Set archallyBlueprint.diagnostics.schemaRoot to a local schema tree.',
  });
});
