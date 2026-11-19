import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  const events = new Map<string, Set<(value: any) => void>>();
  const disk = new Map<string, string>();
  const documents: any[] = [];
  const searches: any[] = [];
  const reads: string[] = [];
  const configuration = new Map<string, any>();
  const diagnostics = new Map<string, any[]>();
  const hovers: any[] = [];
  const definitions: any[] = [];
  const completions: any[] = [];
  const painted: Array<{ type: any; ranges: any[] }> = [];
  let findFilesGate: Promise<void> | undefined;
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
    ThemeColor: class { constructor(public id: string) {} },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    CompletionItem: class { constructor(public label: any, public kind: number) {} },
    CompletionItemKind: { Reference: 1 },
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
      registerDefinitionProvider: (_selector: any, provider: any) => {
        definitions.push(provider);
        return { dispose() {} };
      },
      registerCompletionItemProvider: (_selector: any, provider: any) => {
        completions.push(provider);
        return { dispose() {} };
      },
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
      showWarningMessage: vi.fn(), visibleTextEditors: [] as any[],
      createTextEditorDecorationType: (options: any) => ({ options, dispose() {} }),
      onDidChangeActiveTextEditor: event('active-editor'),
      onDidChangeVisibleTextEditors: event('visible-editors'),
    },
    workspace: {
      textDocuments: documents,
      workspaceFolders: [] as Array<{ uri: Uri }>,
      asRelativePath: (uri: Uri) => uri.fsPath.replace(/^\/synthetic\//, ''),
      getConfiguration: () => ({ get: (key: string, fallback?: unknown) => configuration.get(key) ?? fallback }),
      findFiles: async (pattern: any) => {
        await findFilesGate;
        searches.push(pattern);
        const workspaceRoots = vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath);
        const searchRoots = typeof pattern === 'string' ? (workspaceRoots.length ? workspaceRoots : ['']) : [pattern.base];
        const glob = typeof pattern === 'string' ? pattern : pattern.pattern;
        return [...disk.keys()].filter(file => searchRoots.some(base => {
          if (!file.startsWith(base + '/')) {
            return false;
          }
          const relative = file.slice(base.length + 1);
          if (relative.split('/').includes('node_modules')) {
            return false;
          }
          if (glob.includes('.blueprint/') && !relative.split('/').includes('.blueprint')) {
            return false;
          }
          return glob === '**/*.yml' ? file.endsWith('.yml') : /\.ya?ml$/.test(file);
        })).map(Uri.file);
      },
      fs: { readFile: async (uri: Uri) => {
        reads.push(uri.fsPath);
        if (!disk.has(uri.fsPath)) {
          throw Error('missing');
        }
        return Buffer.from(disk.get(uri.fsPath)!);
      } },
      createFileSystemWatcher: () => ({ onDidChange: event('watch-change'), onDidCreate: event('watch-create'), onDidDelete: event('watch-delete'), dispose: vi.fn() }),
      onDidOpenTextDocument: event('open'), onDidChangeTextDocument: event('change'),
      onDidSaveTextDocument: event('save'), onDidCloseTextDocument: event('close'),
      onDidCreateFiles: event('create'), onDidDeleteFiles: event('delete'),
      onDidRenameFiles: event('rename'), onDidChangeWorkspaceFolders: event('workspace'),
      onDidChangeConfiguration: event('config'),
    },
  };
  return { vscode, disk, documents, configuration, diagnostics, events, hovers, definitions, completions, painted, searches, reads,
    holdFindFiles: () => { let release!: () => void; findFilesGate = new Promise<void>(resolve => { release = resolve; }); return release; },
    emit: (name: string, value: any) => { for (const listener of events.get(name) ?? []) listener(value); },
    publications: () => publications, disposed: () => disposed,
    reset: () => {
      events.clear();
      searches.length = 0;
      reads.length = 0;
      vscode.workspace.workspaceFolders.length = 0;
      definitions.length = 0;
      completions.length = 0;
      hovers.length = 0;
      disk.clear();
      documents.length = 0;
      painted.length = 0;
      findFilesGate = undefined;
      vscode.window.visibleTextEditors.length = 0;
      configuration.clear();
      diagnostics.clear();
      publications = 0;
      disposed = false;
    },
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

async function navigationHover(token = 'WI001') {
  host.configuration.set('highlight.enabled', false);
  host.configuration.set('codeRef.highlight.enabled', false);
  const subscriptions: Array<{ dispose(): void }> = [];
  await activate({ subscriptions, asAbsolutePath: () => path.resolve(__dirname, '../../../../schemas/blueprint/v2.8') } as any);
  registration = { refresh() {}, dispose() { for (const subscription of subscriptions) subscription.dispose(); } };
  const range = new host.vscode.Range(0, 0, 0, 5);
  return host.hovers[0].provideHover({ getWordRangeAtPosition: () => range, getText: () => token }, range.start).contents.value as string;
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


it('resolves one layer declaration instead of five migration mentions', async () => {
  host.disk.set(uri('orders/concepts.yaml').fsPath, 'concepts:\n  - id: orders.CN001\n    name: Order');
  host.disk.set(uri('.migrations/002.migration.yaml').fsPath,
    'migration: {id: MIG002}\nchanges:\n  entities:\n    - kind: split\n      before: {id: orders.CN001}\n      after: [{id: orders.CN001}]');
  host.disk.set(uri('.migrations/004.migration.yaml').fsPath,
    'migration: {id: MIG004}\nchanges:\n  entities:\n    - kind: add\n      after: {id: orders.CN001}\n    - kind: modify\n      before: {id: orders.CN001}\n      after: {id: orders.CN001}');
  await navigationHover('orders.CN001');
  const range = new host.vscode.Range(0, 0, 0, 12);
  const locations = host.definitions[0].provideDefinition({
    getWordRangeAtPosition: () => range,
    getText: () => 'orders.CN001',
  }, range.start);
  expect(locations).toHaveLength(1);
  expect(locations[0].uri.fsPath).toBe(uri('orders/concepts.yaml').fsPath);
  expect(locations[0].range).toEqual(new host.vscode.Range(1, 8, 1, 20));
});


function definitionsFor(token: string) {
  const range = new host.vscode.Range(0, 0, 0, token.length);
  return host.definitions[0].provideDefinition({
    getWordRangeAtPosition: () => range,
    getText: () => token,
  }, range.start);
}

it('restores introduction targets after layer creation, unsaved removal and deletion', async () => {
  const migration = uri('migration.yml');
  const layer = uri('orders/concepts.yaml');
  host.disk.set(migration.fsPath, 'migration: {id: MIG001}\nchange_set: [{kind: new, entity: {id: orders.CN001, name: Future order}}]');
  await navigationHover('orders.CN001');
  expect(definitionsFor('orders.CN001')[0].uri.fsPath).toBe(migration.fsPath);
  host.disk.set(layer.fsPath, 'concepts: [{id: orders.CN001, name: Layer order}]');
  host.emit('watch-create', layer);
  await settle();
  expect(definitionsFor('orders.CN001').map((location: any) => location.uri.fsPath)).toEqual([layer.fsPath]);
  let overlayText = 'concepts: []';
  const document = { uri: layer, getText: () => overlayText };
  host.documents.push(document);
  host.emit('change', { document });
  expect(definitionsFor('orders.CN001')[0].uri.fsPath).toBe(migration.fsPath);
  overlayText = 'concepts: [{id: orders.CN001, name: Unsaved order}]';
  host.emit('change', { document });
  expect(definitionsFor('orders.CN001')[0].uri.fsPath).toBe(layer.fsPath);
  host.documents.length = 0;
  host.emit('close', document);
  await settle();
  expect(definitionsFor('orders.CN001')[0].uri.fsPath).toBe(layer.fsPath);
  host.disk.delete(layer.fsPath);
  host.emit('watch-delete', layer);
  await settle();
  expect(definitionsFor('orders.CN001')[0].uri.fsPath).toBe(migration.fsPath);
  expect(definitionsFor('MIG001')).toHaveLength(1);
});

it('uses unsaved introductions on rebuild and provides no target for migration references', async () => {
  const migration = uri('migration.yaml');
  host.disk.set(migration.fsPath, 'changes: {entities: [{kind: modify, after: {id: orders.CN999}}]}');
  host.documents.push({ uri: migration, getText: () => 'change_set: [{kind: new, entity: {id: orders.CN001}}]' });
  await navigationHover('orders.CN001');
  expect(definitionsFor('orders.CN001')).toHaveLength(1);
  expect(definitionsFor('orders.CN999')).toBeUndefined();
});

it('preserves genuine layer duplicates and introductions in other model roots', async () => {
  host.disk.set(uri('a.yaml').fsPath, 'concepts: [{id: orders.CN001}]');
  host.disk.set(uri('b.yaml').fsPath, 'concepts: [{id: orders.CN001}]');
  host.disk.set(uri('migration.yaml').fsPath, 'change_set: [{kind: new, id: orders.CN001}]');
  const foreign = '/other/.blueprint/v2.8/migration.yaml';
  host.disk.set(foreign, 'change_set: [{kind: new, id: orders.CN001}]');
  const markdown = await navigationHover('orders.CN001');
  expect(definitionsFor('orders.CN001').map((location: any) => location.uri.fsPath).sort()).toEqual([uri('a.yaml').fsPath, uri('b.yaml').fsPath, foreign].sort());
  expect(markdown).not.toContain(`${root}/migration.yaml`);
  expect(markdown).toContain(foreign);
});


it('uses the same preferred declaration for hover and completion regardless of indexing order', async () => {
  host.disk.set(uri('migration.yaml').fsPath, 'change_set: [{kind: new, entity: {id: orders.CMD001, name: Future submission}}]');
  host.disk.set(uri('orders/domain.yaml').fsPath, 'commands: [{id: orders.CMD001, name: Submit order}]');
  host.disk.set(uri('references.migration.yml').fsPath, 'changes: {entities: [{kind: modify, after: {id: orders.CMD999, name: Reference only}}]}');
  const markdown = await navigationHover('orders.CMD001');
  expect(markdown).toContain('Submit order');
  expect(markdown).not.toContain('Future submission');
  const text = 'triggers_operations: ';
  const items = host.completions[0].provideCompletionItems({ getText: () => text }, { line: 0, character: text.length });
  expect(items).toHaveLength(1);
  expect(items[0].label.label).toBe('orders.CMD001');
  expect(items[0].label.detail).toBe('  Submit order');
  expect(items[0].label.description).toBe('.blueprint/v2.8/orders/domain.yaml');
});


it('paints the open editor before the workspace index completes and repaints every known id after it', async () => {
  host.configuration.set('codeRef.highlight.enabled', false);
  host.disk.set(uri('orders/concepts.yaml').fsPath, 'concepts:\n  - id: orders.CN001');
  const models = { uri: uri('orders/models.yaml'), getText: () => 'models:\n  - id: orders.MDL001\n    concept: orders.CN001' };
  host.documents.push(models);
  host.vscode.window.visibleTextEditors.push({ document: models, setDecorations: (type: any, ranges: any[]) => host.painted.push({ type, ranges }) });
  const releaseWorkspace = host.holdFindFiles();
  const subscriptions: Array<{ dispose(): void }> = [];
  registration = { refresh() {}, dispose() { for (const subscription of subscriptions) subscription.dispose(); } };
  const lines = () => {
    const idPaints = host.painted.filter(call => call.type.options.color?.id === 'archallyBlueprint.idForeground');
    const latest = idPaints[idPaints.length - 1];
    return latest?.ranges.map((range: any) => range.start.line);
  };

  const activation = activate({ subscriptions, asAbsolutePath: () => path.resolve(__dirname, '../../../../schemas/blueprint/v2.8') } as any);
  await settle();

  expect(lines()).toEqual([1]);
  expect(host.definitions.length).toBeGreaterThan(0);
  releaseWorkspace();
  await activation;
  expect(lines()).toEqual([1, 2]);
});


it('indexes a closed layer declaration when only its model folder and referring buffer are open', async () => {
  const modelRoot = '/synthetic/shop/.blueprint/v2.6';
  const declaration = `${modelRoot}/orders/concepts.yaml`;
  host.vscode.workspace.workspaceFolders.push({ uri: host.vscode.Uri.file(modelRoot) });
  host.disk.set(declaration, 'concepts:\n  - id: orders.CN001');
  host.documents.push({
    uri: host.vscode.Uri.file(`${modelRoot}/orders/models.yaml`),
    getText: () => 'models: [{id: orders.MDL001, concept: orders.CN001}]',
  });

  await navigationHover('orders.MDL001');

  const locations = definitionsFor('orders.CN001');
  expect(locations).toHaveLength(1);
  expect(locations[0].uri.fsPath).toBe(declaration);
  expect(locations[0].range).toEqual(new host.vscode.Range(1, 8, 1, 20));
});

it('keeps the configured discovery glob for a workspace outside a blueprint folder', async () => {
  host.vscode.workspace.workspaceFolders.push({ uri: host.vscode.Uri.file('/synthetic') });
  host.configuration.set('fileGlob', '**/*.yml');
  host.disk.set(uri('orders/concepts.yml').fsPath, 'concepts: [{id: orders.CN001}]');
  host.disk.set(uri('orders/concepts.yaml').fsPath, 'concepts: [{id: orders.CN002}]');

  await navigationHover('orders.CN001');

  expect(host.searches).toEqual(['**/*.yml']);
  expect(definitionsFor('orders.CN001')).toHaveLength(1);
  expect(definitionsFor('orders.CN002')).toBeUndefined();
});

it('indexes each file once across mixed and overlapping workspace roots', async () => {
  const nestedRoot = '/synthetic/shop/.blueprint/v2.6';
  const nestedDeclaration = `${nestedRoot}/orders/concepts.yml`;
  const otherDeclaration = '/elsewhere/shop/.blueprint/v2.6/orders/concepts.yaml';
  const rootDeclaration = uri('orders/concepts.yaml').fsPath;
  for (const folder of ['/synthetic', nestedRoot, '/elsewhere/shop/.blueprint/v2.6']) {
    host.vscode.workspace.workspaceFolders.push({ uri: host.vscode.Uri.file(folder) });
  }
  for (const declaration of [rootDeclaration, nestedDeclaration, otherDeclaration]) {
    host.disk.set(declaration, 'concepts: [{id: orders.CN001}]');
  }
  host.disk.set('/synthetic/unrelated.yaml', 'concepts: [{id: orders.CN999}]');
  host.disk.set(`${nestedRoot}/node_modules/vendor.yaml`, 'concepts: [{id: orders.CN998}]');

  await navigationHover('orders.CN001');

  expect(definitionsFor('orders.CN001').map((location: any) => location.uri.fsPath).sort())
    .toEqual([rootDeclaration, nestedDeclaration, otherDeclaration].sort());
  expect(host.reads.slice().sort()).toEqual([rootDeclaration, nestedDeclaration, otherDeclaration].sort());
  expect(host.searches[0]).toBe('**/.blueprint/**/*.{yaml,yml}');
  expect(host.searches.slice(1).map(pattern => [pattern.base, pattern.pattern])).toEqual([
    [nestedRoot, '**/*.{yaml,yml}'],
    ['/elsewhere/shop/.blueprint/v2.6', '**/*.{yaml,yml}'],
  ]);
  expect(definitionsFor('orders.CN999')).toBeUndefined();
  expect(definitionsFor('orders.CN998')).toBeUndefined();
});
