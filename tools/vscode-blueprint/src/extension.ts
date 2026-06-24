import * as vscode from 'vscode';

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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await rebuildIndex();

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector(), definitionProvider),
    vscode.languages.registerHoverProvider(selector(), hoverProvider),
    vscode.commands.registerCommand('archallyBlueprint.reindex', rebuildIndex),
    vscode.commands.registerCommand('archallyBlueprint.goto', async (uriStr: string, line: number, character: number) => {
      const uri = vscode.Uri.parse(uriStr);
      const sel = new vscode.Range(line, character, line, character);
      await vscode.window.showTextDocument(uri, { selection: sel });
    }),
  );

  // Keep the index fresh.
  const watcher = vscode.workspace.createFileSystemWatcher(currentGlob());
  watcher.onDidChange(reindexFile);
  watcher.onDidCreate(reindexFile);
  watcher.onDidDelete((uri) => removeFile(uri.toString()));
  context.subscriptions.push(
    watcher,
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (vscode.languages.match(selector(), d) > 0) indexText(d.uri, d.getText());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('archallyBlueprint.fileGlob')) void rebuildIndex();
    }),
  );
}

export function deactivate(): void {
  index.clear();
  fileIds.clear();
}
