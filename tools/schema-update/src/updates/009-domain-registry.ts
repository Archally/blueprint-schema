import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// A slice is a folder; a domain is a region of the problem space. From v2.8.6 the two are declared
// apart: `blueprint.yaml` carries a root `domains[]` registry (each domain with a `DMN###` id and
// the subdomains it divides into, each with an `SDM###` id), and a bounded context names the
// domain it realizes by that id. This module promotes what a model already said about its problem
// space, in the only place it could say it before, into that registry:
//
//   layout:                                  layout:
//     slices:                                  slices:
//       - name: orders                           - name: orders
//         description: "Cart to delivery."        description: "Cart to delivery."
//         type: core-domain             =>
//         subdomains:                          domains:
//           - cart                                 - id: DMN001
//           - checkout                               name: orders
//                                                    description: "Cart to delivery."
//   # orders/orders.arch.yaml                       type: core-domain
//   contexts:                                       subdomains:
//     - id: BC001                                     - id: SDM001
//       domain_ref: orders            =>                name: cart
//                                                     - id: SDM002
//   # orders/orders.arch.yaml                           name: checkout
//   contexts:
//     - id: BC001
//       domain_ref: DMN001
//
// WHAT SEEDS A DOMAIN. Two sources, in this order.
//
// A SLICE that classified itself (`type`) or declared subdomains, and any slice a context names in
// `domain_ref`. A slice that said nothing about the problem space seeds nothing.
//
// A GLOSSARY KEY - the root `domains:` free-string map an architecture or process document may
// carry, one entry per domain, name to prose. It seeds even when its name matches no slice: a key
// is a declaration that the domain exists and what it is about, where a `domain_ref` is only a
// reference to one. The prose becomes the domain's `description` and LEAVES the document, so the
// model states each domain once; a key naming a domain the registry already declares stays where
// it is, because two authored descriptions is a disagreement no tool should silently resolve.
//
// Either way the registry states only what the model already stated, restated with an id. Ids are
// taken in slice order and then in document order, above whatever the file already holds, so a
// re-run after an author has added a domain by hand continues the sequence rather than colliding
// with it.
//
// WHAT MOVES AND WHAT IS COPIED. `type` and `subdomains` leave the slice, because a folder has no
// strategic importance and holds no subdomains. `description`, `owner`, `complexity` and
// `model_traits` are copied onto the domain and left on the slice: the folder keeps describing
// itself, and a registry entry without a description would be an authored entity that says
// nothing. A subdomain's `kind` is written as `type`, in the vocabulary v2.8 uses for the whole
// problem-space axis; a value no version ever accepted is dropped, and the warning names it.
//
// TEXT, NOT YAML. Inherited from the modules before it and load-bearing for the same reason: this
// tool has no runtime dependencies and its modules edit text so comments, key order, quoting and
// line endings survive. Every value the registry carries is the slice's own line, re-indented.
//
// WHAT IT REFUSES. Flow-style `slices: [...]`, a slice entry with no name, and a slice whose dash
// line opens with the key being moved: each is reported and left alone, because rewriting a shape
// this module cannot read back is the failure it exists to avoid.

const ARCH_FILE = /^(arch\.(yaml|yml)|[^/\\]+[.-]arch\.(yaml|yml))$/i;
const STORY_FILE = /^(story\.(yaml|yml)|[^/\\]+[.-]story\.(yaml|yml))$/i;
/** A block-scalar head (`>`, `|-`, `>2`), which owns the lines below it rather than a value beside it. */
const BLOCK_SCALAR = /^[>|][+-]?\d*$/;
/** A `domain_ref` already stating a registry id - a domain or, since 2.8.7, one of its subdomains. */
const REGISTRY_ID = /^(DMN|SDM)\d{3,}$/;
const ANY_DOMAIN_ID = /\bDMN(\d{3,})\b/g;
const ANY_SUBDOMAIN_ID = /\bSDM(\d{3,})\b/g;
const KEY_LINE = /^(\s*)([A-Za-z_][\w-]*):(.*)$/;
const DOMAIN_REF_LINE = /^(\s*)domain_ref:\s*(["']?)([^"'#\s]+)\2\s*(#.*)?$/;

/** The slice-era spellings of a subdomain's importance, and the v2.8 word for each. */
const SUBDOMAIN_KIND_MAP: Record<string, string> = {
  core: 'core-domain',
  supporting: 'supporting-domain',
  generic: 'generic-domain',
};
const SUBDOMAIN_KINDS = new Set(['core-domain', 'supporting-domain', 'generic-domain', 'technical-capability']);

/** Keys copied from a slice onto its domain, in the order the registry writes them. */
const DOMAIN_KEY_ORDER = ['description', 'type', 'complexity', 'model_traits', 'owner'];
/** Keys a subdomain entry carries, in the order the registry writes them; `kind` is written as `type`. */
const SUBDOMAIN_KEY_ORDER = ['description', 'type', 'complexity', 'model_traits', 'owner'];
const SUBDOMAIN_KNOWN_KEYS = new Set(['name', 'kind', ...SUBDOMAIN_KEY_ORDER]);

interface SourceLine {
  text: string;
  /** The line's own terminator, so a rewritten file keeps its CRLF/LF intact. */
  eol: string;
}

/** A mapping key inside an entry: the comment lines written directly above it, its own line and every deeper line. */
interface KeyBlock {
  key: string;
  /** Inline value text after `key:`, trimmed; empty when the key opens a block. */
  value: string;
  /** First line of the block, which is the first comment directly above the key when there is one. */
  start: number;
  keyLine: number;
  /** Exclusive. Trailing blank lines are not part of the block. */
  end: number;
}

/** One `- ` entry of a block sequence. */
interface SequenceEntry {
  dashLine: number;
  dashIndent: number;
  /** Column at which the entry's own keys start. */
  keyColumn: number;
  /** Exclusive. */
  end: number;
  /** A string entry's value, unquoted; null for a mapping entry. */
  scalar: string | null;
  /** The key on the dash line itself, when the entry is a mapping. */
  firstKey: KeyBlock | null;
  /** Every key of the entry, the dash-line key included, in source order. */
  keys: KeyBlock[];
  /** A `- { key: value, ... }` entry, its pairs in source order with raw values; null otherwise. */
  flow: Map<string, string> | null;
}

/**
 * The pairs of a one-line flow mapping `{ a: 1, b: "x, y", c: [1, 2], d: { e: f } }`, values kept
 * verbatim so a nested flow list or mapping is written back exactly as it was read. Null when the
 * text is not a single flow mapping.
 */
function parseFlowMapping(text: string): Map<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let depth = 0;
  let quote: string | null = null;
  let close = -1;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1) return null;
  const inner = trimmed.slice(1, close);
  const pairs: string[] = [];
  let current = '';
  depth = 0;
  quote = null;
  for (const character of inner) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
    if (character === ',' && depth === 0) {
      pairs.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim().length > 0) pairs.push(current);
  const mapping = new Map<string, string>();
  for (const pair of pairs) {
    const colon = pair.indexOf(':');
    if (colon === -1) continue;
    mapping.set(pair.slice(0, colon).trim(), pair.slice(colon + 1).trim());
  }
  return mapping;
}

function scanLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let position = 0;
  for (;;) {
    const newline = content.indexOf('\n', position);
    if (newline === -1) {
      if (position < content.length) lines.push({ text: content.slice(position), eol: '' });
      return lines;
    }
    const crlf = newline > position && content[newline - 1] === '\r';
    lines.push({ text: content.slice(position, crlf ? newline - 1 : newline), eol: crlf ? '\r\n' : '\n' });
    position = newline + 1;
  }
}

function joinLines(lines: SourceLine[]): string {
  return lines.map((line) => line.text + line.eol).join('');
}

function dominantEol(lines: SourceLine[]): string {
  return lines.some((line) => line.eol === '\r\n') ? '\r\n' : '\n';
}

function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

function isComment(text: string): boolean {
  return text.trimStart().startsWith('#');
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Strip a trailing `# comment` from an inline scalar, respecting a quoted value. */
function inlineValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0]!;
    const close = trimmed.indexOf(quote, 1);
    return close === -1 ? trimmed : trimmed.slice(0, close + 1);
  }
  const hash = trimmed.indexOf(' #');
  return (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
}

/** Exclusive end of the block opened at `openLine`: every following line deeper than `column`, blank lines inside but not trailing. */
function blockEnd(lines: SourceLine[], openLine: number, column: number, limit: number): number {
  let end = openLine + 1;
  for (let index = openLine + 1; index < limit; index += 1) {
    const text = lines[index]!.text;
    if (isBlank(text)) continue;
    if (indentOf(text) <= column) break;
    end = index + 1;
  }
  return end;
}

/** Full-line comments directly above `line`, at any indentation, back to the previous non-comment line. */
function commentsAbove(lines: SourceLine[], line: number, floor: number): number {
  let start = line;
  while (start - 1 >= floor && isComment(lines[start - 1]!.text)) start -= 1;
  return start;
}

/** The keys declared at exactly `column` between `from` and `to`. */
function readKeys(lines: SourceLine[], from: number, to: number, column: number): KeyBlock[] {
  const keys: KeyBlock[] = [];
  for (let index = from; index < to; index += 1) {
    const text = lines[index]!.text;
    if (isBlank(text) || isComment(text) || indentOf(text) !== column) continue;
    const match = text.match(KEY_LINE);
    if (!match) continue;
    const end = blockEnd(lines, index, column, to);
    keys.push({ key: match[2]!, value: match[3]!.trim(), start: commentsAbove(lines, index, from), keyLine: index, end });
    index = end - 1;
  }
  return keys;
}

/** The entries of the block sequence whose first dash sits on `firstDash`. */
function readSequence(lines: SourceLine[], firstDash: number, limit: number): SequenceEntry[] {
  const dashIndent = indentOf(lines[firstDash]!.text);
  const entries: SequenceEntry[] = [];
  let index = firstDash;
  while (index < limit) {
    const text = lines[index]!.text;
    if (isBlank(text) || isComment(text)) {
      index += 1;
      continue;
    }
    const indent = indentOf(text);
    if (indent < dashIndent) break;
    if (indent > dashIndent) {
      index += 1;
      continue;
    }
    const dash = text.match(/^(\s*)-(\s*)(.*)$/);
    if (!dash) break;
    const spacing = dash[2]!.length === 0 ? 1 : dash[2]!.length;
    const keyColumn = dashIndent + 1 + spacing;
    let end = index + 1;
    for (let cursor = index + 1; cursor < limit; cursor += 1) {
      const candidate = lines[cursor]!.text;
      if (isBlank(candidate)) continue;
      if (isComment(candidate) && indentOf(candidate) < keyColumn) break;
      if (!isComment(candidate) && indentOf(candidate) < keyColumn) break;
      end = cursor + 1;
    }
    const remainder = dash[3]!;
    const flow = parseFlowMapping(remainder);
    const inlineKey = flow ? null : remainder.match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (flow) {
      entries.push({ dashLine: index, dashIndent, keyColumn, end, scalar: null, firstKey: null, keys: [], flow });
    } else if (inlineKey) {
      const firstKey: KeyBlock = {
        key: inlineKey[1]!,
        value: inlineKey[2]!.trim(),
        start: index,
        keyLine: index,
        end: blockEnd(lines, index, keyColumn, end),
      };
      const rest = readKeys(lines, firstKey.end, end, keyColumn);
      entries.push({ dashLine: index, dashIndent, keyColumn, end, scalar: null, firstKey, keys: [firstKey, ...rest], flow: null });
    } else {
      entries.push({ dashLine: index, dashIndent, keyColumn, end, scalar: unquote(inlineValue(remainder)), firstKey: null, keys: [], flow: null });
    }
    index = end;
  }
  return entries;
}

/** The column-0 key blocks of a document. */
function topLevelKeys(lines: SourceLine[]): KeyBlock[] {
  return readKeys(lines, 0, lines.length, 0);
}

/** Re-indent a block so that its key sits at `targetColumn`; relative indentation inside is kept. */
function reindent(lines: SourceLine[], start: number, end: number, fromColumn: number, targetColumn: number, eol: string): SourceLine[] {
  const out: SourceLine[] = [];
  for (let index = start; index < end; index += 1) {
    const text = lines[index]!.text;
    if (isBlank(text)) {
      out.push({ text: '', eol });
      continue;
    }
    const indent = indentOf(text);
    const shifted = ' '.repeat(Math.max(0, indent - fromColumn + targetColumn)) + text.trimStart();
    out.push({ text: shifted, eol });
  }
  return out;
}

/**
 * The lines of one key block, with the dash-line key rendered as an ordinary key line.
 *
 * A key that MOVES takes the comment written above it along, since the comment is about the key
 * and the key is leaving; a key that is COPIED leaves its comment where it was written, because a
 * remark duplicated into the registry would read as two authors saying the same thing.
 */
function keyBlockLines(lines: SourceLine[], entry: SequenceEntry, block: KeyBlock, targetColumn: number, eol: string, moves: boolean): SourceLine[] {
  if (block === entry.firstKey) {
    const head: SourceLine = { text: ' '.repeat(targetColumn) + `${block.key}:` + (block.value ? ` ${block.value}` : ''), eol };
    return [head, ...reindent(lines, block.keyLine + 1, block.end, entry.keyColumn, targetColumn, eol)];
  }
  return reindent(lines, moves ? block.start : block.keyLine, block.end, entry.keyColumn, targetColumn, eol);
}

interface DomainSeed {
  sliceName: string;
  id: string;
  entry: SequenceEntry | null;
  /** The lines to write under `domains:`. */
  lines: SourceLine[];
  subdomainCount: number;
}

interface Counters {
  domain: number;
  subdomain: number;
}

function highest(pattern: RegExp, content: string): number {
  let max = 0;
  for (const match of content.matchAll(pattern)) max = Math.max(max, Number(match[1]));
  return max;
}

function pad(counter: number): string {
  return String(counter).padStart(3, '0');
}

interface RegistryEntry {
  id: string;
  name: string;
}

/** The domains a `domains:` block already declares, by id and name. */
function readRegistry(lines: SourceLine[], block: KeyBlock): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  let firstDash = -1;
  for (let index = block.keyLine + 1; index < block.end; index += 1) {
    const text = lines[index]!.text;
    if (!isBlank(text) && !isComment(text) && text.trimStart().startsWith('-')) {
      firstDash = index;
      break;
    }
  }
  if (firstDash === -1) return entries;
  for (const entry of readSequence(lines, firstDash, block.end)) {
    const id = entry.keys.find((key) => key.key === 'id');
    const name = entry.keys.find((key) => key.key === 'name');
    if (id && name) entries.push({ id: unquote(inlineValue(id.value)), name: unquote(inlineValue(name.value)) });
  }
  return entries;
}

interface Document {
  relativePath: string;
  absolutePath: string;
  /** True for an architecture file. A process file carries a glossary but never a `domain_ref`. */
  arch: boolean;
  lines: SourceLine[];
}

interface ArchReference {
  document: Document;
  lineIndex: number;
  value: string;
}

/** One glossary key: a domain a document names, with the map that holds it. */
interface GlossaryEntry {
  document: Document;
  /** The root `domains:` block this key sits in. */
  map: KeyBlock;
  /** The key itself - its name is the domain's name, its value the domain's description. */
  key: KeyBlock;
  /** Column the map's keys sit at, so a block scalar can be re-indented into the registry. */
  column: number;
  /** How many keys the map holds, so a map that empties can go with its last key. */
  siblings: number;
}

/**
 * Every architecture and process document under the model, read ONCE.
 *
 * One file can carry both a `domain_ref` to rewrite and a glossary key to promote, and both edits
 * land on the same line array. Reading the file once per edit would give each its own copy, and
 * whichever wrote second would discard the other.
 */
function loadDocuments(root: string): Document[] {
  const found: Document[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      const arch = ARCH_FILE.test(entry.name);
      if (!arch && !STORY_FILE.test(entry.name)) continue;
      found.push({
        relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
        absolutePath,
        arch,
        lines: scanLines(fs.readFileSync(absolutePath, 'utf8')),
      });
    }
  };
  walk(root);
  return found.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function collectDomainReferences(documents: Document[]): ArchReference[] {
  const references: ArchReference[] = [];
  for (const document of documents) {
    if (!document.arch) continue;
    document.lines.forEach((line, lineIndex) => {
      const match = line.text.match(DOMAIN_REF_LINE);
      if (match) references.push({ document, lineIndex, value: match[3]! });
    });
  }
  return references;
}

/**
 * Every glossary key in the model: a root `domains:` mapping of name to prose.
 *
 * A block opening a sequence is the registry's shape, not the glossary's, so a document carrying
 * one is left alone rather than misread.
 */
function collectGlossaries(documents: Document[]): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const document of documents) {
    const map = topLevelKeys(document.lines).find((candidate) => candidate.key === 'domains');
    if (!map || map.value.length > 0) continue;
    let column = -1;
    let sequence = false;
    for (let index = map.keyLine + 1; index < map.end; index += 1) {
      const text = document.lines[index]!.text;
      if (isBlank(text) || isComment(text)) continue;
      sequence = text.trimStart().startsWith('-');
      column = indentOf(text);
      break;
    }
    if (sequence || column <= 0) continue;
    const keys = readKeys(document.lines, map.keyLine + 1, map.end, column);
    for (const key of keys) entries.push({ document, map, key, column, siblings: keys.length });
  }
  return entries;
}

/** The glossary key rendered as the domain's `description`, its own value kept verbatim. */
function describedAs(glossary: GlossaryEntry, eol: string): SourceLine[] {
  const { key } = glossary;
  const inline = key.value.length > 0;
  const head: SourceLine = { text: inline ? `    description: ${key.value}` : '    description:', eol };
  const body = key.end > key.keyLine + 1;
  if (inline && !BLOCK_SCALAR.test(key.value)) return [head];
  if (!body) return inline ? [head] : [];
  return [head, ...reindent(glossary.document.lines, key.keyLine + 1, key.end, glossary.column, 4, eol)];
}

interface Analysis {
  changes: PlannedChange[];
  warnings: string[];
  blueprint: { absolutePath: string; lines: SourceLine[] } | null;
  seeds: DomainSeed[];
  registryBlock: KeyBlock | null;
  layoutBlock: KeyBlock | null;
  rewrites: { reference: ArchReference; id: string }[];
  documents: Document[];
  /** The glossary keys promoted into the registry, which leave the documents that held them. */
  promotions: GlossaryEntry[];
}

function analyse(blueprintDir: string): Analysis {
  const analysis: Analysis = { changes: [], warnings: [], blueprint: null, seeds: [], registryBlock: null, layoutBlock: null, rewrites: [], documents: [], promotions: [] };
  const blueprintPath = path.join(blueprintDir, 'blueprint.yaml');
  if (!fs.existsSync(blueprintPath)) {
    analysis.warnings.push('blueprint.yaml: not found - nothing to promote');
    return analysis;
  }
  const lines = scanLines(fs.readFileSync(blueprintPath, 'utf8'));
  analysis.blueprint = { absolutePath: blueprintPath, lines };
  const eol = dominantEol(lines);
  const top = topLevelKeys(lines);
  analysis.layoutBlock = top.find((block) => block.key === 'layout') ?? null;
  analysis.registryBlock = top.find((block) => block.key === 'domains') ?? null;

  let slicesKey: KeyBlock | null = null;
  if (analysis.layoutBlock) {
    const block = analysis.layoutBlock;
    let childColumn = -1;
    for (let index = block.keyLine + 1; index < block.end; index += 1) {
      const text = lines[index]!.text;
      if (isBlank(text) || isComment(text)) continue;
      childColumn = indentOf(text);
      break;
    }
    if (childColumn > 0) slicesKey = readKeys(lines, block.keyLine + 1, block.end, childColumn).find((key) => key.key === 'slices') ?? null;
  }
  analysis.documents = loadDocuments(blueprintDir);
  const references = collectDomainReferences(analysis.documents);
  const glossaries = collectGlossaries(analysis.documents);
  const registry = analysis.registryBlock ? readRegistry(lines, analysis.registryBlock) : [];
  const nameToId = new Map<string, string>(registry.map((entry) => [entry.name, entry.id]));

  let entries: SequenceEntry[] = [];
  if (!slicesKey) {
    analysis.warnings.push('blueprint.yaml: no `layout.slices` block - nothing to promote');
  } else if (slicesKey.value.length > 0) {
    analysis.warnings.push('blueprint.yaml: flow-style `slices:` - rewrite it in block style, then run the update again');
  } else {
    let firstDash = -1;
    for (let index = slicesKey.keyLine + 1; index < slicesKey.end; index += 1) {
      const text = lines[index]!.text;
      if (!isBlank(text) && !isComment(text)) {
        if (text.trimStart().startsWith('-')) firstDash = index;
        break;
      }
    }
    if (firstDash !== -1) entries = readSequence(lines, firstDash, slicesKey.end);
  }

  const referenced = new Set(references.map((reference) => reference.value));
  const counters: Counters = {
    domain: highest(ANY_DOMAIN_ID, joinLines(lines)),
    subdomain: highest(ANY_SUBDOMAIN_ID, joinLines(lines)),
  };

  for (const entry of entries) {
    if (entry.flow) {
      analysis.warnings.push(`blueprint.yaml:${entry.dashLine + 1}: flow-style slice entry - rewrite it in block style, then run the update again`);
      continue;
    }
    let name: string | null = entry.scalar;
    let nameRaw: string = entry.scalar ?? '';
    if (entry.scalar === null) {
      const nameKey = entry.keys.find((key) => key.key === 'name');
      if (!nameKey) {
        analysis.warnings.push(`blueprint.yaml:${entry.dashLine + 1}: slice entry without a name - skipped`);
        continue;
      }
      nameRaw = inlineValue(nameKey.value);
      name = unquote(nameRaw);
    } else {
      nameRaw = inlineValue(lines[entry.dashLine]!.text.replace(/^\s*-\s*/, ''));
    }
    if (name === null) continue;
    const typeKey = entry.keys.find((key) => key.key === 'type') ?? null;
    const subdomainsKey = entry.keys.find((key) => key.key === 'subdomains') ?? null;
    const carriesProblemSpace = typeKey !== null || subdomainsKey !== null;
    if (!carriesProblemSpace && !referenced.has(name)) continue;
    if (nameToId.has(name)) {
      if (carriesProblemSpace) {
        analysis.warnings.push(
          `blueprint.yaml:${entry.dashLine + 1}: slice "${name}" still carries type or subdomains, and the registry already declares a domain of that name - merge them by hand`,
        );
      }
      continue;
    }
    if (entry.firstKey && (entry.firstKey.key === 'type' || entry.firstKey.key === 'subdomains')) {
      analysis.warnings.push(
        `blueprint.yaml:${entry.dashLine + 1}: slice "${name}" opens its dash line with \`${entry.firstKey.key}:\` - move \`name:\` first, then run the update again`,
      );
      continue;
    }

    counters.domain += 1;
    const id = `DMN${pad(counters.domain)}`;
    const written: SourceLine[] = [
      { text: `  - id: ${id}`, eol },
      { text: `    name: ${nameRaw}`, eol },
    ];
    for (const key of DOMAIN_KEY_ORDER) {
      const block = entry.keys.find((candidate) => candidate.key === key);
      if (block) written.push(...keyBlockLines(lines, entry, block, 4, eol, key === 'type'));
    }
    let subdomainCount = 0;
    if (subdomainsKey) {
      const commentStart = subdomainsKey.start;
      for (let index = commentStart; index < subdomainsKey.keyLine; index += 1) {
        written.push({ text: '    ' + lines[index]!.text.trimStart(), eol });
      }
      written.push({ text: '    subdomains:', eol });
      let firstDash = -1;
      for (let index = subdomainsKey.keyLine + 1; index < subdomainsKey.end; index += 1) {
        const text = lines[index]!.text;
        if (!isBlank(text) && !isComment(text)) {
          if (text.trimStart().startsWith('-')) firstDash = index;
          break;
        }
      }
      const items = firstDash === -1 ? [] : readSequence(lines, firstDash, subdomainsKey.end);
      for (const item of items) {
        if (item.flow) {
          const flowName = item.flow.get('name');
          if (!flowName) {
            analysis.warnings.push(`blueprint.yaml:${item.dashLine + 1}: subdomain entry without a name under slice "${name}" - skipped`);
            continue;
          }
          counters.subdomain += 1;
          subdomainCount += 1;
          written.push({ text: `      - id: SDM${pad(counters.subdomain)}`, eol });
          written.push({ text: `        name: ${flowName}`, eol });
          for (const key of SUBDOMAIN_KEY_ORDER) {
            if (key === 'type') {
              const raw = item.flow.get('type') ?? item.flow.get('kind');
              if (raw === undefined) continue;
              const plain = unquote(raw);
              const mapped = SUBDOMAIN_KIND_MAP[plain] ?? (SUBDOMAIN_KINDS.has(plain) ? plain : null);
              if (mapped === null) {
                analysis.warnings.push(
                  `blueprint.yaml:${item.dashLine + 1}: subdomain "${unquote(flowName)}" declares kind "${plain}", which no version accepts - dropped; classify it by hand in the registry`,
                );
                continue;
              }
              written.push({ text: `        type: ${mapped}`, eol });
              continue;
            }
            const raw = item.flow.get(key);
            if (raw !== undefined) written.push({ text: `        ${key}: ${raw}`, eol });
          }
          for (const [key, raw] of item.flow) {
            if (SUBDOMAIN_KNOWN_KEYS.has(key)) continue;
            written.push({ text: `        ${key}: ${raw}`, eol });
          }
          continue;
        }
        let itemName: string | null = item.scalar;
        let itemNameRaw: string = item.scalar ?? '';
        if (item.scalar === null) {
          const nameKey = item.keys.find((key) => key.key === 'name');
          if (!nameKey) {
            analysis.warnings.push(`blueprint.yaml:${item.dashLine + 1}: subdomain entry without a name under slice "${name}" - skipped`);
            continue;
          }
          itemNameRaw = inlineValue(nameKey.value);
          itemName = unquote(itemNameRaw);
        } else {
          itemNameRaw = inlineValue(lines[item.dashLine]!.text.replace(/^\s*-\s*/, ''));
        }
        counters.subdomain += 1;
        subdomainCount += 1;
        written.push({ text: `      - id: SDM${pad(counters.subdomain)}`, eol });
        written.push({ text: `        name: ${itemNameRaw}`, eol });
        if (item.scalar !== null) continue;
        const kindKey = item.keys.find((key) => key.key === 'kind') ?? null;
        for (const key of SUBDOMAIN_KEY_ORDER) {
          if (key === 'type') {
            const typeSource = item.keys.find((candidate) => candidate.key === 'type') ?? kindKey;
            if (!typeSource) continue;
            const raw = unquote(inlineValue(typeSource.value));
            const mapped = SUBDOMAIN_KIND_MAP[raw] ?? (SUBDOMAIN_KINDS.has(raw) ? raw : null);
            if (mapped === null) {
              analysis.warnings.push(
                `blueprint.yaml:${typeSource.keyLine + 1}: subdomain "${itemName}" declares kind "${raw}", which no version accepts - dropped; classify it by hand in the registry`,
              );
              continue;
            }
            written.push({ text: `        type: ${mapped}`, eol });
            continue;
          }
          const block = item.keys.find((candidate) => candidate.key === key);
          if (block) written.push(...keyBlockLines(lines, item, block, 8, eol, true));
        }
        for (const block of item.keys) {
          if (SUBDOMAIN_KNOWN_KEYS.has(block.key)) continue;
          written.push(...keyBlockLines(lines, item, block, 8, eol, true));
        }
      }
    }
    nameToId.set(name, id);
    analysis.seeds.push({ sliceName: name, id, entry: carriesProblemSpace ? entry : null, lines: written, subdomainCount });
    analysis.changes.push({
      type: 'edit-yaml',
      path: 'blueprint.yaml',
      detail: `${id} "${name}" seeded from slice "${name}" with ${subdomainCount} subdomain(s)`,
    });
  }

  // The second source. A slice says which folder holds a domain's model; a glossary key says the
  // domain exists and what it is about. Promoted after the slices so a model carrying both keeps
  // the ids its layout order implies, and before the references so a `domain_ref` naming a domain
  // only the glossary declared still resolves to an id.
  for (const glossary of glossaries) {
    const name = glossary.key.key;
    const value = unquote(inlineValue(glossary.key.value));
    const where = `${glossary.document.relativePath}:${glossary.key.keyLine + 1}`;
    if (REGISTRY_ID.test(value)) {
      analysis.warnings.push(`${where}: domains["${name}"] holds the id ${value} rather than prose - left alone, it states nothing the registry does not`);
      continue;
    }
    const existing = nameToId.get(name);
    if (existing) {
      analysis.warnings.push(`${where}: domains["${name}"] names a domain the registry already declares (${existing}) - left alone, merge the two descriptions by hand`);
      continue;
    }
    counters.domain += 1;
    const id = `DMN${pad(counters.domain)}`;
    const written: SourceLine[] = [
      { text: `  - id: ${id}`, eol },
      { text: `    name: ${name}`, eol },
      ...describedAs(glossary, eol),
    ];
    nameToId.set(name, id);
    analysis.seeds.push({ sliceName: name, id, entry: null, lines: written, subdomainCount: 0 });
    analysis.promotions.push(glossary);
    analysis.changes.push({
      type: 'edit-yaml',
      path: 'blueprint.yaml',
      detail: `${id} "${name}" seeded from the \`domains:\` glossary of ${glossary.document.relativePath}`,
    });
  }

  for (const reference of references) {
    if (REGISTRY_ID.test(reference.value)) continue;
    const id = nameToId.get(reference.value);
    if (!id) {
      analysis.warnings.push(
        `${reference.document.relativePath}:${reference.lineIndex + 1}: domain_ref "${reference.value}" names no domain the model declares - left alone, point it at a DMN### by hand`,
      );
      continue;
    }
    analysis.rewrites.push({ reference, id });
    analysis.changes.push({
      type: 'edit-yaml',
      path: reference.document.relativePath,
      detail: `domain_ref "${reference.value}" -> ${id} (line ${reference.lineIndex + 1})`,
    });
  }

  if (analysis.changes.length === 0 && analysis.warnings.length === 0) {
    analysis.warnings.push('Every slice is a folder already, no document names a domain in prose, and every domain_ref is an id - nothing to promote.');
  }
  return analysis;
}

/** The blueprint document after the seeded domains are written and the promoted keys leave their slices. */
function rewriteBlueprint(analysis: Analysis): string {
  const lines = [...analysis.blueprint!.lines];
  const eol = dominantEol(lines);
  const removals: { start: number; end: number }[] = [];
  for (const seed of analysis.seeds) {
    if (!seed.entry) continue;
    for (const block of seed.entry.keys) {
      if (block.key === 'type' || block.key === 'subdomains') removals.push({ start: block.start, end: block.end });
    }
  }
  removals.sort((left, right) => right.start - left.start);
  const registryLines = analysis.seeds.flatMap((seed) => seed.lines);

  let insertAt: number;
  let prefix: SourceLine[] = [];
  if (analysis.registryBlock) {
    insertAt = analysis.registryBlock.end;
  } else {
    insertAt = analysis.layoutBlock!.end;
    prefix = [{ text: '', eol }, { text: 'domains:', eol }];
  }
  // Removals sit inside the layout block, so they shift the insertion point when it lies below them.
  for (const removal of removals) {
    if (removal.end <= insertAt) insertAt -= removal.end - removal.start;
    lines.splice(removal.start, removal.end - removal.start);
  }
  const lastLine = lines[lines.length - 1];
  if (lastLine && lastLine.eol === '' && insertAt >= lines.length) lastLine.eol = eol;
  lines.splice(insertAt, 0, ...prefix, ...registryLines);
  return joinLines(lines);
}

function rewriteArch(reference: ArchReference, id: string): void {
  const line = reference.document.lines[reference.lineIndex]!;
  const match = line.text.match(DOMAIN_REF_LINE)!;
  const comment = match[4] ? ` ${match[4]}` : '';
  line.text = `${match[1]}domain_ref: ${id}${comment}`;
}

function buildPlan(blueprintDir: string): UpdatePlan {
  const analysis = analyse(blueprintDir);
  return { sourceVersion: '2.8', targetVersion: '2.8', description: update.description, changes: analysis.changes, warnings: analysis.warnings };
}

/**
 * A document after the glossary keys it gave up have left it, and without the map itself when they
 * were all of it. A key that stayed - one naming a domain the registry already declares - keeps
 * the map alive, because dropping it would delete prose no other file carries.
 */
function rewriteGlossary(document: Document, promoted: GlossaryEntry[]): string {
  const map = promoted[0]!.map;
  const removals =
    promoted.length === promoted[0]!.siblings
      ? [{ start: map.start, end: map.end }]
      : promoted.map((entry) => ({ start: entry.key.start, end: entry.key.end }));
  const lines = [...document.lines];
  removals.sort((left, right) => right.start - left.start);
  for (const removal of removals) lines.splice(removal.start, removal.end - removal.start);
  return joinLines(lines);
}

function applyPlan(blueprintDir: string): UpdateResult {
  const analysis = analyse(blueprintDir);
  const plan: UpdatePlan = { sourceVersion: '2.8', targetVersion: '2.8', description: update.description, changes: analysis.changes, warnings: analysis.warnings };
  const errors: string[] = [];
  if (analysis.changes.length === 0) return { ...plan, applied: true, errors };
  try {
    if (analysis.seeds.length > 0) fs.writeFileSync(analysis.blueprint!.absolutePath, rewriteBlueprint(analysis), 'utf8');
    // A document's line array is shared by every edit against it, and `rewriteArch` edits the line
    // objects in place. So the reference rewrites land first, the glossary removal is computed on
    // top of them, and each document is written exactly once.
    const promotedBy = new Map<Document, GlossaryEntry[]>();
    for (const promotion of analysis.promotions) {
      const promoted = promotedBy.get(promotion.document) ?? [];
      promoted.push(promotion);
      promotedBy.set(promotion.document, promoted);
    }
    const touched = new Set<Document>(promotedBy.keys());
    for (const rewrite of analysis.rewrites) {
      rewriteArch(rewrite.reference, rewrite.id);
      touched.add(rewrite.reference.document);
    }
    for (const document of touched) {
      const promoted = promotedBy.get(document);
      fs.writeFileSync(document.absolutePath, promoted ? rewriteGlossary(document, promoted) : joinLines(document.lines), 'utf8');
    }
  } catch (error) {
    errors.push(`write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...plan, applied: errors.length === 0, errors };
}

export const update: SchemaUpdate = {
  sourceVersion: '2.8',
  targetVersion: '2.8',
  description:
    'Domain registry (v2.8.6): every slice that classified itself or declared subdomains seeds a domain in `blueprint.yaml` `domains[]`, its subdomains get ids, and a context names its domain by id in `domain_ref` instead of naming the slice',
  plan: buildPlan,
  apply: applyPlan,
};
