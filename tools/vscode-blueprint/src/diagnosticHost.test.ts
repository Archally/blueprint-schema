import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  const events = new Map<string, Set<(value: any) => void>>();
  const disk = new Map<string, string>();
  const documents: any[] = [];
  const configuration = new Map<string, any>();
  const diagnostics = new Map<string, any[]>();
  const hovers: any[] = [];
  let publications = 0;
  let disposed = false;
  function event(name: string) {
    return (listener: (value: any) => void) => {
      const listeners = events.get(name) ?? new Set();
      listeners.add(listener); events.set(name, listeners);
      return { dispose: () => listeners.delete(listener) };
    };
  }
  class Uri {
    scheme = 'file';
    constructor(public fsPath: string) {}
    get path() { return this.fsPath; }
    static file(file: string) { return new Uri(file); }
    toString() { return `file://${this.fsPath}`; }
  }
  class Range {
    start: { line: number; character: number }; end: { line: number; character: number };
    constructor(a: number, b: number, c: number, d: number) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; }
  }
  const vscode = {
    Uri, Range,
    MarkdownString: class {
      value = '';
      appendMarkdown(text: string) { this.value += text; return this; }
    },
    Hover: class { constructor(public contents: any, public range: Range) {} },
    Location: class { constructor(public uri: Uri, public range: Range) {} },
    Diagnostic: class { constructor(public range: Range, public message: string, public severity: number) {} },
    DiagnosticRelatedInformation: class { constructor(public location: any, public message: string) {} },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    RelativePattern: class { constructor(public base: string, public pattern: string) {} },
    commands: { registerCommand: () => ({ dispose() {} }) },
    languages: {
      registerDefinitionProvider: () => ({ dispose() {} }),
      registerCompletionItemProvider: () => ({ dispose() {} }),
      registerDocumentLinkProvider: () => ({ dispose() {} }),
      registerHoverProvider: (_selector: any, provider: any) => { hovers.push(provider); return { dispose() {} }; },
      match: (selector: any, document: any) => document.uri.scheme === 'file' && (selector.pattern.includes('yml') ? /\.ya?ml$/.test(document.uri.fsPath) : document.uri.fsPath.endsWith('.yaml')) ? 1 : 0,
      createDiagnosticCollection: () => ({
        clear: () => diagnostics.clear(),
        set: (entries: any[]) => { for (const [uri, values] of entries) diagnostics.set(uri.fsPath, values); publications++; },
        delete: (uri: Uri) => diagnostics.delete(uri.fsPath),
        dispose: () => { disposed = true; diagnostics.clear(); },
      }),
    },
    window: {
      showWarningMessage: vi.fn(), visibleTextEditors: [],
      onDidChangeActiveTextEditor: event('active-editor'),
      onDidChangeVisibleTextEditors: event('visible-editors'),
    },
    workspace: {
      textDocuments: documents,
      asRelativePath: (uri: Uri) => uri.fsPath.replace(/^\/synthetic\//, ''),
      getConfiguration: () => ({ get: (key: string, fallback?: unknown) => configuration.get(key) ?? fallback }),
      findFiles: async (pattern: any) => [...disk.keys()].filter(file => typeof pattern === 'string' ? (pattern === '**/*.yml' ? file.endsWith('.yml') : pattern.includes('yml') || file.endsWith('.yaml')) : file.startsWith(pattern.base + '/')).map(Uri.file),
      fs: { readFile: async (uri: Uri) => { if (!disk.has(uri.fsPath)) throw Error('missing'); return Buffer.from(disk.get(uri.fsPath)!); } },
      createFileSystemWatcher: () => ({ onDidChange: event('watch-change'), onDidCreate: event('watch-create'), onDidDelete: event('watch-delete'), dispose: vi.fn() }),
      onDidOpenTextDocument: event('open'), onDidChangeTextDocument: event('change'),
      onDidSaveTextDocument: event('save'), onDidCloseTextDocument: event('close'),
      onDidCreateFiles: event('create'), onDidDeleteFiles: event('delete'),
      onDidRenameFiles: event('rename'), onDidChangeWorkspaceFolders: event('workspace'),
      onDidChangeConfiguration: event('config'),
    },
  };
  return { vscode, disk, documents, configuration, diagnostics, events, hovers,
    emit: (name: string, value: any) => { for (const listener of events.get(name) ?? []) listener(value); },
    publications: () => publications, disposed: () => disposed,
    reset: () => { events.clear(); hovers.length = 0; disk.clear(); documents.length = 0; configuration.clear(); diagnostics.clear(); publications = 0; disposed = false; },
  };
});
vi.mock('vscode', () => host.vscode);
import { activate, deactivate, registerDiagnostics } from './extension';
const root = '/synthetic/.blueprint/v2.8';
const uri = (file: string) => host.vscode.Uri.file(`${root}/${file}`);
const all = () => [...host.diagnostics.values()].flat();
let registration: ReturnType<typeof registerDiagnostics>;
async function settle(delay = 0) {
  await vi.advanceTimersByTimeAsync(delay);
  for (let turn = 0; turn < 20; turn++) await new Promise<void>(resolve => setImmediate(resolve));
}
function start() {
  registration = registerDiagnostics({ subscriptions: [], asAbsolutePath: () => path.resolve(__dirname, '../../../../schemas/blueprint/v2.8') } as any);
}
beforeEach(() => { host.reset(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { registration?.dispose(); deactivate(); vi.useRealTimers(); });

it('publishes native diagnostics with exact ranges and every related location at activation', async () => {
  host.disk.set(uri('a.roadmap.yml').fsPath, 'work_items: [{id: "WI001"}]');
  host.disk.set(uri('b.roadmap.yaml').fsPath, 'work_items: [{id: WI001}]');
  start(); await settle();
  expect(all()).toHaveLength(2);
  const diagnostic = host.diagnostics.get(uri('a.roadmap.yml').fsPath)![0];
  expect(diagnostic.source).toBe('Archally');
  expect(diagnostic.code).toBe('duplicate-id');
  expect(diagnostic.severity).toBe(0);
  expect(diagnostic.range.start).toEqual({ line: 0, character: 19 });
  expect(diagnostic.range.end).toEqual({ line: 0, character: 24 });
  expect(diagnostic.relatedInformation[0].location.uri.fsPath).toBe(uri('b.roadmap.yaml').fsPath);
});
it('debounces inactive dirty overlays and repairs closed sibling reference diagnostics', async () => {
  host.disk.set(uri('a.roadmap.yaml').fsPath, 'work_items: [{id: WI001, milestone: MS999}]');
  host.disk.set(uri('b.roadmap.yml').fsPath, 'milestones: []');
  start(); await settle();
  expect(all().map(item => item.code)).toEqual(['dangling-reference']);
  const document = { uri: uri('b.roadmap.yml'), getText: () => 'milestones: [{id: MS999}]' };
  host.documents.push(document);
  host.emit('change', { document });
  await settle(299);
  expect(all()).toHaveLength(1);
  await settle(1);
  expect(all()).toEqual([]);
});
it('restores disk state on dirty close and clears errors when a file is deleted', async () => {
  host.disk.set(uri('a.roadmap.yaml').fsPath, 'work_items: [{id: WI001, milestone: MS999}]');
  host.disk.set(uri('b.roadmap.yml').fsPath, 'milestones: []');
  const document = { uri: uri('b.roadmap.yml'), getText: () => 'milestones: [{id: MS999}]' };
  host.documents.push(document);
  start(); await settle();
  expect(all()).toEqual([]);
  host.documents.length = 0; host.emit('close', document); await settle();
  expect(all()).toHaveLength(1);
  host.disk.delete(uri('a.roadmap.yaml').fsPath); host.emit('watch-delete', uri('a.roadmap.yaml')); await settle();
  expect(all()).toEqual([]);
});
it('refreshes severity, delay and file eligibility immediately when settings change', async () => {
  host.disk.set(uri('a.roadmap.yaml').fsPath, 'work_items: [{id: WI001, milestone: MS999}]');
  start(); await settle();
  host.configuration.set('diagnostics.danglingSeverity', 'hint');
  host.configuration.set('diagnostics.debounceMs', 10);
  host.emit('config', { affectsConfiguration: () => true }); await settle();
  expect(all()[0].severity).toBe(3);
  const document = { uri: uri('a.roadmap.yaml'), getText: () => 'work_items: []' };
  host.documents.push(document); host.emit('change', { document }); await settle(10);
  expect(all()).toEqual([]);
  host.documents.length = 0;
  host.configuration.set('fileGlob', '**/*.yml'); host.emit('config', { affectsConfiguration: () => true }); await settle();
  expect(all()).toEqual([]);
  host.disk.clear(); host.emit('workspace', {}); await settle();
  expect(all()).toEqual([]);
});
it('refreshes on open, save, create, rename, workspace and explicit reindex', async () => {
  host.disk.set(uri('a.roadmap.yaml').fsPath, 'work_items: [{id: WI001}]');
  start(); await settle(); expect(all()).toEqual([]);
  host.disk.set(uri('b.roadmap.yaml').fsPath, 'work_items: [{id: WI001}]');
  host.emit('watch-create', uri('b.roadmap.yaml')); await settle(); expect(all()).toHaveLength(2);
  const document = { uri: uri('b.roadmap.yaml'), getText: () => 'work_items: [{id: WI002}]' };
  host.documents.push(document); host.emit('open', document); await settle(); expect(all()).toEqual([]);
  host.documents.length = 0;
  host.disk.set(uri('b.roadmap.yaml').fsPath, document.getText()); host.emit('save', document); await settle(); expect(all()).toEqual([]);
  host.disk.delete(uri('b.roadmap.yaml').fsPath); host.disk.set(uri('c.roadmap.yaml').fsPath, 'work_items: [{id: WI001}]');
  host.emit('rename', { files: [{ oldUri: uri('b.roadmap.yaml'), newUri: uri('c.roadmap.yaml') }] }); await settle(); expect(all()).toHaveLength(2);
  host.disk.set(uri('c.roadmap.yaml').fsPath, 'work_items: []'); registration.refresh(); await settle(); expect(all()).toEqual([]);
});
it('disposes the collection, timers and event listeners', async () => {
  host.disk.set(uri('a.roadmap.yaml').fsPath, 'work_items: [{id: WI001, milestone: MS999}]');
  start(); await settle(); expect(all()).toHaveLength(1);
  host.emit('change', { document: { uri: uri('a.roadmap.yaml') } });
  const publications = host.publications(); registration.dispose(); await settle(300);
  expect(host.disposed()).toBe(true);
  expect(all()).toEqual([]);
  expect(host.publications()).toBe(publications);
  expect([...host.events.values()].every(listeners => listeners.size === 0)).toBe(true);
});

async function navigationHover() {
  host.configuration.set('highlight.enabled', false);
  host.configuration.set('codeRef.highlight.enabled', false);
  const subscriptions: Array<{ dispose(): void }> = [];
  await activate({ subscriptions, asAbsolutePath: () => path.resolve(__dirname, '../../../../schemas/blueprint/v2.8') } as any);
  registration = { refresh() {}, dispose() { for (const subscription of subscriptions) subscription.dispose(); } };
  const range = new host.vscode.Range(0, 0, 0, 5);
  return host.hovers[0].provideHover({ getWordRangeAtPosition: () => range, getText: () => 'WI001' }, range.start).contents.value as string;
}

it('labels every hover declaration with its model root across projects and versions and retains jump targets', async () => {
  const files = [
    '/synthetic/main/.blueprint/v2.8/delivery.roadmap.yaml',
    '/synthetic/main/.blueprint/v2.8/extra.roadmap.yaml',
    '/synthetic/other/.blueprint/v2.8/delivery.roadmap.yaml',
    '/synthetic/main/.blueprint/v2.7/delivery.roadmap.yaml',
  ];
  for (const file of files) host.disk.set(file, 'work_items:\n  - id: WI001');

  const markdown = await navigationHover();

  expect(markdown.match(/Model: /g)).toHaveLength(4);
  for (const file of files) {
    const relative = file.replace('/synthetic/', '');
    expect(markdown).toContain(`Model: \`${relative.slice(0, relative.lastIndexOf('/'))}\``);
    expect(markdown).toContain(`[${relative}:2]`);
    expect(markdown).toContain(encodeURIComponent(JSON.stringify([`file://${file}`, 1, 8])));
  }
});

it('joins hover kind, name and summary with hyphens and keeps a single-root hover compact', async () => {
  host.disk.set(uri('delivery.roadmap.yaml').fsPath, 'work_items:\n  - id: WI001\n    kind: epic\n    name: First\n    summary: Delivery work');

  const markdown = await navigationHover();

  expect(markdown).toContain('**`WI001`** - epic First - Delivery work');
  expect(markdown).not.toContain('Model: ');
});
