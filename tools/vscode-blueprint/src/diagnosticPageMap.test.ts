import * as path from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  const files = new Map<string, string>();
  const documents: any[] = [];
  const providers = new Map<string, { selector: any; provider: any }>();
  class Uri {
    constructor(public fsPath: string) {}
    static file(file: string) { return new Uri(file); }
    static parse(value: string) { return new Uri(value); }
    toString() { return this.fsPath; }
  }
  class Range {
    start: { line: number; character: number };
    end: { line: number; character: number };
    constructor(firstLine: number, firstCharacter: number, lastLine: number, lastCharacter: number) {
      this.start = { line: firstLine, character: firstCharacter };
      this.end = { line: lastLine, character: lastCharacter };
    }
  }
  const register = (kind: string) => (selector: any, provider: any) => {
    providers.set(kind, { selector, provider });
    return { dispose() {} };
  };
  return {
    files, documents, providers,
    vscode: {
      Uri, Range,
      RelativePattern: class { constructor(public base: string, public pattern: string) {} },
      Location: class { constructor(public uri: Uri, public range: Range) {} },
      Hover: class { constructor(public contents: any, public range: Range) {} },
      MarkdownString: class {
        value = '';
        appendText(value: string) {
          this.value += value;
          return this;
        }
      },
      DocumentLink: class { constructor(public range: Range, public target: Uri) {} },
      languages: {
        registerDefinitionProvider: register('definition'),
        registerHoverProvider: register('hover'),
        registerDocumentLinkProvider: register('links'),
      },
      workspace: {
        textDocuments: documents,
        findFiles: async (pattern: any) => [...files.keys()]
          .filter(file => file.startsWith(pattern.base + '/'))
          .map(Uri.file),
        fs: {
          readFile: async (uri: Uri) => {
            if (!files.has(uri.fsPath)) throw Error('missing');
            return Buffer.from(files.get(uri.fsPath)!);
          },
        },
      },
    },
  };
});
vi.mock('vscode', () => host.vscode);
import { registerPageMapProviders } from './extension';

const project = '/synthetic/shop';
const modelFile = `${project}/.blueprint/v2.8/sample/decisions.yaml`;
const mapFile = `${project}/.confluence/map/handbook/architecture/sample.D001/_page.yaml`;
function document(text = 'key: "sample.D001"\nkind: decision\npage_id: \'123\'\n', file = mapFile) {
  return {
    uri: host.vscode.Uri.file(file),
    getText: () => text,
    positionAt(offset: number) {
      const lines = text.slice(0, offset).split('\n');
      return { line: lines.length - 1, character: lines[lines.length - 1].length };
    },
  };
}
function provider(kind: string) {
  return host.providers.get(kind)!.provider;
}
beforeEach(() => {
  host.files.clear();
  host.documents.length = 0;
  host.providers.clear();
  host.files.set(modelFile, 'decisions:\n  - id: sample.D001\n    title: Use a queue\n    status: accepted\n');
  host.files.set(`${project}/.confluence/map/handbook/_hub.yaml`,
    'kind: content-hub\nkey: handbook\nsite: https://docs.example.test/wiki\nspace_key: "DE MO"\n');
  registerPageMapProviders({ subscriptions: [] } as any);
});
it('registers only map definition, hover and link selectors', () => {
  expect([...host.providers.keys()]).toEqual(['definition', 'hover', 'links']);
  for (const registration of host.providers.values()) {
    expect(registration.selector).toEqual({ language: 'yaml', scheme: 'file', pattern: '**/.confluence/map/**/*.yaml' });
  }
});
it('jumps from a quoted decision key to its sibling declaration and exact range', async () => {
  host.files.set('/synthetic/other/.blueprint/v2.8/decisions.yaml', host.files.get(modelFile)!);
  const locations = await provider('definition').provideDefinition(document(), { line: 0, character: 10 });
  expect(locations).toHaveLength(1);
  expect(locations[0].uri.fsPath).toBe(modelFile);
  expect(locations[0].range).toEqual(new host.vscode.Range(1, 8, 1, 19));
});
it('shows model title and status using unsaved model content', async () => {
  host.documents.push(document('decisions:\n  - id: sample.D001\n    title: Revised queue\n    status: proposed\n', modelFile));
  const hover = await provider('hover').provideHover(document(), { line: 0, character: 10 });
  expect(hover.contents.value).toContain('Revised queue');
  expect(hover.contents.value).toContain('proposed');
  expect(hover.range).toEqual(new host.vscode.Range(0, 6, 0, 17));
});
it('reports missing entities without resolving an identically named foreign entity', async () => {
  host.files.delete(modelFile);
  host.files.set('/synthetic/other/.blueprint/v2.8/decisions.yaml', 'decisions: [{ id: sample.D001 }]');
  expect(await provider('definition').provideDefinition(document(), { line: 0, character: 10 })).toBeUndefined();
  const hover = await provider('hover').provideHover(document(), { line: 0, character: 10 });
  expect(hover.contents.value).toContain('not declared');
});
it('does not navigate hub keys, nested keys, titles, comments or key property names', async () => {
  const sources = [
    ['key: sample.D001\nkind: content-hub\n', 0, 10],
    ['key: hub\nkind: decision\nnested:\n  key: sample.D001\n', 3, 10],
    ['key: sample.D001\nkind: decision\ntitle: sample.D001\n', 2, 10],
    ['key: sample.D001 # sample.D001\nkind: decision\n', 0, 25],
    ['key: sample.D001\nkind: decision\n', 0, 1],
  ] as const;
  for (const [text, line, character] of sources) {
    expect(await provider('definition').provideDefinition(document(text), { line, character })).toBeUndefined();
    expect(await provider('hover').provideHover(document(text), { line, character })).toBeUndefined();
  }
});
it('links page_id using the root hub binding and ignores nested overrides', async () => {
  host.files.set(path.dirname(path.dirname(mapFile)) + '/_hub.yaml', 'kind: content-hub\nsite: https://wrong.example.test\nspace_key: WRONG\n');
  const links = await provider('links').provideDocumentLinks(document());
  expect(links).toHaveLength(1);
  expect(links[0].target.toString()).toBe('https://docs.example.test/wiki/spaces/DE%20MO/pages/123');
  expect(links[0].range).toEqual(new host.vscode.Range(2, 10, 2, 13));
});
it('omits page links when the binding or confirmed numeric identity is unavailable', async () => {
  const rootHub = `${project}/.confluence/map/handbook/_hub.yaml`;
  for (const binding of ['', 'kind: content-hub\nspace_key: DEMO\n', 'kind: content-hub\nsite: javascript:alert(1)\nspace_key: DEMO\n']) {
    host.files.set(rootHub, binding);
    expect(await provider('links').provideDocumentLinks(document())).toEqual([]);
  }
  host.files.set(rootHub, 'kind: content-hub\nsite: https://docs.example.test\nspace_key: DEMO\n');
  expect(await provider('links').provideDocumentLinks(document('key: pending\nkind: brief\n'))).toEqual([]);
  expect(await provider('links').provideDocumentLinks(document('page_id: invalid\nkind: brief\n'))).toEqual([]);
});
it('ignores malformed YAML and resolves inline model declarations', async () => {
  expect(await provider('definition').provideDefinition(document('key: [broken\nkind: decision'), { line: 0, character: 8 })).toBeUndefined();
  host.files.set(modelFile, 'decisions: [{ id: sample.D001, title: Inline queue, status: accepted }]');
  const hover = await provider('hover').provideHover(document(), { line: 0, character: 10 });
  expect(hover.contents.value).toContain('Inline queue');
  expect(hover.contents.value).toContain('accepted');
});

it('adds the Confluence Cloud wiki path for a bare root site and reads unsaved hub edits', async () => {
  const hub = `${project}/.confluence/map/handbook/_hub.yaml`;
  host.documents.push(document('kind: content-hub\nsite: https://cloud.example.test\nspace_key: DEMO\n', hub));
  const links = await provider('links').provideDocumentLinks(document());
  expect(links[0].target.toString()).toBe('https://cloud.example.test/wiki/spaces/DEMO/pages/123');
});
