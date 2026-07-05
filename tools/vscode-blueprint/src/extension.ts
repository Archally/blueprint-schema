import * as vscode from 'vscode';
import {
  parseRepositoryConfig,
  resolveBrowserUrl,
  scanCodeRefPaths,
  scanEvidenceSources,
  scanUrls,
  type CodeRefHit,
  type RepoConfigSet,
} from './codeRef';

/**
 * Archally Blueprint Navigation
 * --------------------------------
 * Adds go-to-definition + hover for blueprint entity IDs (e.g. `billing.CMD012`, `orders.EVT006`,
 * `R005`, `MIG003`, `CAT1200`) across the `.blueprint/**` YAML files. The redhat.vscode-yaml
 * extension already gives schema validation + hover on property KEYS; this adds cross-file
 * resolution of the ID VALUES, which the JSON Schema only validates by shape, not by target.
 *
 * Index source: every `id:` declaration (block `- id: X` or inline `{ id: X, ... }`). No model.json
 * dependency — the line scan gives exact locations and works before the model is built.
 */

const DEFAULT_GLOB = '**/.blueprint/**/*.yaml';

// A blueprint id under the cursor: scoped (`slice.TYPE###`) or bare (`TYPE###` / `MIG###` / `CAT####`).
const TOKEN_RE = /[a-z][a-z0-9-]*\.[A-Za-z]{1,6}\d{2,5}|[A-Za-z]{1,6}\d{2,5}/;

// An `id:` declaration — block (`  - id: X`) or inline flow map (`{ id: X, ... }`).
const DECL_RE = /(?:^|[\s{,])id:\s*['"]?([A-Za-z][A-Za-z0-9.\-]*?\d{2,5})['"]?(?=[\s,}\]]|$)/g;

interface Decl {
  uri: vscode.Uri;
  range: vscode.Range;
  summary: string;
}

const index = new Map<string, Decl[]>();
const fileIds = new Map<string, Set<string>>(); // uriString -> ids declared in that file
// code_ref: owning blueprint.yaml uri -> parsed repository config. Cleared on reindex / blueprint.yaml change.
const repoConfigCache = new Map<string, RepoConfigSet>();

function currentGlob(): string {
  return vscode.workspace.getConfiguration('archallyBlueprint').get<string>('fileGlob') || DEFAULT_GLOB;
}

function selector(): vscode.DocumentSelector {
  return { language: 'yaml', scheme: 'file', pattern: currentGlob() };
}

/** Build a short one-line hover descriptor from the lines around an `id:` declaration. */
function summarize(lines: string[], i: number, declLine: string): string {
  let kind = '';
  let name = '';
  let summary = '';

  // Inline flow map on the same line: `{ id: X, description: "...", ... }`.
  const inlineDesc = declLine.match(/\b(?:summary|description|name|title)\s*:\s*['"]?([^'"\n}]+?)['"]?\s*[},]/);

  const indent = declLine.match(/^\s*/)?.[0].length ?? 0;
  for (let j = i; j < Math.min(lines.length, i + 16); j++) {
    const l = lines[j];
    if (j > i) {
      const ind = l.match(/^\s*/)?.[0].length ?? 0;
      if (l.trim().startsWith('- ') && ind <= indent) break; // next list item
      if (/^\s*(?:-\s*)?id:/.test(l)) break; // next entity declaration
    }
    if (!kind) {
      const km = l.match(/^\s*(?:kind|stereotype|type)\s*:\s*['"]?([A-Za-z0-9 _-]+?)['"]?\s*$/);
      if (km) kind = km[1].trim();
    }
    if (!name) {
      const nm = l.match(/^\s*(?:name|title)\s*:\s*['"]?(.+?)['"]?\s*$/);
      if (nm) name = nm[1].trim();
    }
    if (!summary) {
      const sm = l.match(/^\s*(?:summary|description)\s*:\s*(.+?)\s*$/);
      if (sm) {
        let v = sm[1].trim();
        if (v === '>' || v === '|' || v === '>-' || v === '|-' || v === '') {
          // Folded/literal scalar — take the next non-empty deeper line.
          const next = lines[j + 1];
          v = next ? next.trim() : '';
        }
        v = v.replace(/^['"]|['"]$/g, '');
        if (v) summary = v;
      }
    }
  }

  if (!summary && inlineDesc) summary = inlineDesc[1].trim();
  if (summary.length > 160) summary = summary.slice(0, 157) + '…';

  const head = [kind, name].filter(Boolean).join(' ');
  return [head, summary].filter(Boolean).join(' — ');
}

function removeFile(uriStr: string): void {
  const ids = fileIds.get(uriStr);
  if (!ids) return;
  for (const id of ids) {
    const decls = index.get(id);
    if (!decls) continue;
    const kept = decls.filter((d) => d.uri.toString() !== uriStr);
    if (kept.length) index.set(id, kept);
    else index.delete(id);
  }
  fileIds.delete(uriStr);
}

function indexText(uri: vscode.Uri, text: string): void {
  const uriStr = uri.toString();
  removeFile(uriStr);
  const ids = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DECL_RE.exec(line)) !== null) {
      const id = m[1];
      const ch = m.index + m[0].lastIndexOf(id);
      const range = new vscode.Range(i, ch, i, ch + id.length);
      let arr = index.get(id);
      if (!arr) {
        arr = [];
        index.set(id, arr);
      }
      arr.push({ uri, range, summary: summarize(lines, i, line) });
      ids.add(id);
    }
  }
  fileIds.set(uriStr, ids);
}

async function reindexFile(uri: vscode.Uri): Promise<void> {
  try {
    const buf = await vscode.workspace.fs.readFile(uri);
    indexText(uri, Buffer.from(buf).toString('utf8'));
  } catch {
    /* deleted or unreadable — ignore */
  }
}

async function rebuildIndex(): Promise<void> {
  index.clear();
  fileIds.clear();
  repoConfigCache.clear();
  const files = await vscode.workspace.findFiles(currentGlob(), '**/node_modules/**');
  await Promise.all(files.map(reindexFile));
}

function tokenAt(doc: vscode.TextDocument, pos: vscode.Position): string | undefined {
  const range = doc.getWordRangeAtPosition(pos, TOKEN_RE);
  return range ? doc.getText(range) : undefined;
}

const definitionProvider: vscode.DefinitionProvider = {
  provideDefinition(doc, pos) {
    const token = tokenAt(doc, pos);
    const decls = token ? index.get(token) : undefined;
    if (!decls?.length) return undefined;
    return decls.map((d) => new vscode.Location(d.uri, d.range));
  },
};

const hoverProvider: vscode.HoverProvider = {
  provideHover(doc, pos) {
    const range = doc.getWordRangeAtPosition(pos, TOKEN_RE);
    if (!range) return undefined;
    const token = doc.getText(range);
    const decls = index.get(token);
    if (!decls?.length) return undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    for (const d of decls) {
      const rel = vscode.workspace.asRelativePath(d.uri);
      const line = d.range.start.line + 1;
      const gotoArgs = encodeURIComponent(JSON.stringify([d.uri.toString(), d.range.start.line, d.range.start.character]));
      if (d.summary) md.appendMarkdown(`**\`${token}\`** — ${d.summary}\n\n`);
      else md.appendMarkdown(`**\`${token}\`**\n\n`);
      md.appendMarkdown(`📄 [${rel}:${line}](command:archallyBlueprint.goto?${gotoArgs})\n`);
    }
    return new vscode.Hover(md, range);
  },
};

// ── code_ref navigation (ctrl+click a code_ref path → open on the git host) ──────────────────────
// Turns each `code_refs[].path` in a `.blueprint` YAML into a DocumentLink to the file on its git
// host, built from the owning `blueprint.yaml`'s `repository`/`repositories`. Local-clone resolution
// is layered on in a later step; this is the zero-config browser path. Pure URL/parse logic lives in
// codeRef.ts (unit-tested); here we do the vscode-side scanning + link creation.

function codeRefEnabled(): boolean {
  return vscode.workspace.getConfiguration('archallyBlueprint').get<boolean>('codeRef.enabled', true);
}

function referenceLinksEnabled(): boolean {
  return vscode.workspace.getConfiguration('archallyBlueprint').get<boolean>('referenceLinks.enabled', true);
}

/** Resolve a repo-relative evidence source path against the workspace folder(s); return it only if it's a file. */
async function resolveWorkspaceFile(relPath: string): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return undefined;
  const clean = relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!clean) return undefined;
  for (const folder of folders) {
    const candidate = vscode.Uri.joinPath(folder.uri, clean);
    try {
      const stat = await vscode.workspace.fs.stat(candidate);
      if ((stat.type & vscode.FileType.File) !== 0) return candidate;
    } catch {
      /* not in this folder */
    }
  }
  return undefined;
}

function makeLink(hit: CodeRefHit, target: vscode.Uri, tooltip: string): vscode.DocumentLink {
  const link = new vscode.DocumentLink(
    new vscode.Range(hit.line, hit.startCh, hit.line, hit.endCh),
    target,
  );
  link.tooltip = tooltip;
  return link;
}

/** Walk up from a document to the nearest ancestor `blueprint.yaml`. */
async function findOwningBlueprintUri(docUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  let dir = vscode.Uri.joinPath(docUri, '..');
  for (let depth = 0; depth < 16; depth++) {
    const candidate = vscode.Uri.joinPath(dir, 'blueprint.yaml');
    try {
      await vscode.workspace.fs.stat(candidate);
      return candidate;
    } catch {
      /* not here — keep climbing */
    }
    const parent = vscode.Uri.joinPath(dir, '..');
    if (parent.toString() === dir.toString()) break; // reached the filesystem root
    dir = parent;
  }
  return undefined;
}

/** Parsed repository config for the blueprint owning `docUri` (cached per blueprint.yaml). */
async function repoConfigForDoc(docUri: vscode.Uri): Promise<RepoConfigSet | undefined> {
  const blueprintUri = await findOwningBlueprintUri(docUri);
  if (!blueprintUri) return undefined;
  const key = blueprintUri.toString();
  const cached = repoConfigCache.get(key);
  if (cached) return cached;
  try {
    const buf = await vscode.workspace.fs.readFile(blueprintUri);
    const set = parseRepositoryConfig(Buffer.from(buf).toString('utf8'));
    repoConfigCache.set(key, set);
    return set;
  } catch {
    return undefined;
  }
}

const blueprintLinkProvider: vscode.DocumentLinkProvider = {
  async provideDocumentLinks(doc) {
    const links: vscode.DocumentLink[] = [];
    const text = doc.getText();

    // code_refs → git-host file URL (needs the owning blueprint.yaml's repository config).
    if (codeRefEnabled()) {
      const set = await repoConfigForDoc(doc.uri);
      if (set && (set.repository || set.repositories)) {
        for (const hit of scanCodeRefPaths(text)) {
          const url = resolveBrowserUrl(hit.raw, set);
          if (url) links.push(makeLink(hit, vscode.Uri.parse(url), `Open on host: ${url}`));
        }
      }
    }

    // Any http(s):// URL → browser; evidence[].source file-paths → the local workspace file. (No config.)
    if (referenceLinksEnabled()) {
      for (const hit of scanUrls(text)) {
        links.push(makeLink(hit, vscode.Uri.parse(hit.raw), hit.raw));
      }
      for (const hit of scanEvidenceSources(text)) {
        const fileUri = await resolveWorkspaceFile(hit.raw);
        if (fileUri) links.push(makeLink(hit, fileUri, `Open ${hit.raw}`));
      }
    }

    return links;
  },
};

// ── Highlighting (editor decorations — theme-independent, configurable) ──────────────────────────

// Global-flag variant of the token grammar, for scanning a whole document.
const TOKEN_RE_G = /[a-z][a-z0-9-]*\.[A-Za-z]{1,6}\d{2,5}|[A-Za-z]{1,6}\d{2,5}/g;

let decoType: vscode.TextEditorDecorationType | undefined;
let codeRefDecoType: vscode.TextEditorDecorationType | undefined;
let decoTimer: ReturnType<typeof setTimeout> | undefined;

function createDecoType(): vscode.TextEditorDecorationType | undefined {
  const cfg = vscode.workspace.getConfiguration('archallyBlueprint');
  if (!cfg.get<boolean>('highlight.enabled', true)) return undefined;

  const override = (cfg.get<string>('highlight.color') || '').trim();
  const style = cfg.get<string>('highlight.fontStyle', 'bold');
  const opts: vscode.DecorationRenderOptions = {
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    color: override ? override : new vscode.ThemeColor('archallyBlueprint.idForeground'),
  };
  if (style.includes('bold')) opts.fontWeight = 'bold';
  if (style.includes('italic')) opts.fontStyle = 'italic';
  if (style.includes('underline')) opts.textDecoration = 'underline';
  return vscode.window.createTextEditorDecorationType(opts);
}

// Distinct decoration for clickable code_ref paths (link-blue by default — different from IDs).
function createCodeRefDecoType(): vscode.TextEditorDecorationType | undefined {
  const cfg = vscode.workspace.getConfiguration('archallyBlueprint');
  if (!cfg.get<boolean>('codeRef.highlight.enabled', true)) return undefined;

  const override = (cfg.get<string>('codeRef.highlight.color') || '').trim();
  const style = cfg.get<string>('codeRef.highlight.fontStyle', 'underline');
  const opts: vscode.DecorationRenderOptions = {
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    color: override ? override : new vscode.ThemeColor('archallyBlueprint.codeRefForeground'),
  };
  if (style.includes('bold')) opts.fontWeight = 'bold';
  if (style.includes('italic')) opts.fontStyle = 'italic';
  if (style.includes('underline')) opts.textDecoration = 'underline';
  return vscode.window.createTextEditorDecorationType(opts);
}

function rebuildDecoType(): void {
  decoType?.dispose();
  decoType = createDecoType();
  codeRefDecoType?.dispose();
  codeRefDecoType = createCodeRefDecoType();
}

function applyDecorations(editor: vscode.TextEditor | undefined): void {
  if (!editor) return;
  if (vscode.languages.match(selector(), editor.document) === 0) return; // not a blueprint file
  const text = editor.document.getText();
  const lines = text.split(/\r?\n/);

  // Known ids (canary yellow by default).
  if (decoType) {
    const idRanges: vscode.Range[] = [];
    for (let i = 0; i < lines.length; i++) {
      TOKEN_RE_G.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE_G.exec(lines[i])) !== null) {
        if (!index.has(m[0])) continue; // only highlight KNOWN ids — unknown refs / typos stay un-coloured
        idRanges.push(new vscode.Range(i, m.index, i, m.index + m[0].length));
      }
    }
    editor.setDecorations(decoType, idRanges);
  }

  // Links — code_ref paths + any URL + evidence file-paths — share the link-blue colour (E3),
  // and each kind is included only when its feature toggle is on.
  if (codeRefDecoType) {
    const linkHits: CodeRefHit[] = [];
    if (codeRefEnabled()) linkHits.push(...scanCodeRefPaths(text));
    if (referenceLinksEnabled()) linkHits.push(...scanUrls(text), ...scanEvidenceSources(text));
    editor.setDecorations(
      codeRefDecoType,
      linkHits.map((h) => new vscode.Range(h.line, h.startCh, h.line, h.endCh)),
    );
  }
}

function refreshAllDecorations(): void {
  for (const editor of vscode.window.visibleTextEditors) applyDecorations(editor);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await rebuildIndex();
  rebuildDecoType();
  refreshAllDecorations();

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector(), definitionProvider),
    vscode.languages.registerHoverProvider(selector(), hoverProvider),
    vscode.languages.registerDocumentLinkProvider(selector(), blueprintLinkProvider),
    vscode.commands.registerCommand('archallyBlueprint.reindex', rebuildIndex),
    vscode.commands.registerCommand('archallyBlueprint.goto', async (uriStr: string, line: number, character: number) => {
      const uri = vscode.Uri.parse(uriStr);
      const sel = new vscode.Range(line, character, line, character);
      await vscode.window.showTextDocument(uri, { selection: sel });
    }),
  );

  // Keep the index fresh.
  const watcher = vscode.workspace.createFileSystemWatcher(currentGlob());
  const onFsChange = async (uri: vscode.Uri) => {
    await reindexFile(uri);
    if (uri.path.endsWith('/blueprint.yaml')) repoConfigCache.clear();
    refreshAllDecorations(); // the known-id set may have changed
  };
  watcher.onDidChange(onFsChange);
  watcher.onDidCreate(onFsChange);
  watcher.onDidDelete((uri) => {
    removeFile(uri.toString());
    refreshAllDecorations();
  });
  context.subscriptions.push(
    watcher,
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (vscode.languages.match(selector(), d) > 0) {
        indexText(d.uri, d.getText());
        refreshAllDecorations();
      }
      if (d.uri.path.endsWith('/blueprint.yaml')) repoConfigCache.clear();
    }),
    vscode.window.onDidChangeActiveTextEditor((e) => applyDecorations(e)),
    vscode.window.onDidChangeVisibleTextEditors(() => refreshAllDecorations()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || e.document !== ed.document) return;
      if (decoTimer) clearTimeout(decoTimer);
      decoTimer = setTimeout(() => applyDecorations(ed), 150);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('archallyBlueprint.fileGlob')) void rebuildIndex();
      if (
        e.affectsConfiguration('archallyBlueprint.highlight') ||
        e.affectsConfiguration('archallyBlueprint.codeRef') ||
        e.affectsConfiguration('archallyBlueprint.referenceLinks')
      ) {
        rebuildDecoType();
        refreshAllDecorations();
      }
    }),
  );
}

export function deactivate(): void {
  if (decoTimer) clearTimeout(decoTimer);
  decoType?.dispose();
  codeRefDecoType?.dispose();
  index.clear();
  fileIds.clear();
}
