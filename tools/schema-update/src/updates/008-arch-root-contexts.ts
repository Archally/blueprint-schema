import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';
import { modelYamlFiles } from '../model-files.js';

// A bounded context is declared once, a party is declared once, and a service names the system it
// is a component of.
//
// An arch document may declare its contexts nested under a party (`parties[].contexts[]`) or whole
// at the document root (`contexts[]`). The nested form states the party-to-context edge by position,
// which costs one re-declaration of the party per file that declares any of its contexts, and one
// re-declaration of the context per system that provides services to it. This migration rewrites a
// model into the root form:
//
//   parties:                                   parties:            <- only in the registry document
//     - id: PRT014                               - id: PRT014
//       name: Accounting                           name: Accounting
//       env: production                            env: production
//       contexts:                     =>
//         - id: BC001                          system_ref: PRT014  <- the document's default system
//           name: Accounting                   contexts:
//           services:                            - id: BC001
//             - id: SVC001                           name: Accounting
//               name: InvoiceBroker                  services:
//                                                      - id: SVC001
//                                                        name: InvoiceBroker
//
// THE PARTY REGISTRY. Every party's whole declaration is gathered into the model's ROOT arch
// document - `arch.yaml` or `<name>.arch.yaml` beside `blueprint.yaml` - so a reader has one place
// to look for what a system is, and a slice document states only the contexts it owns. A model with
// no root arch document keeps each party in the document holding its most complete declaration, and
// the choice is reported.
//
// THE DOCUMENT DEFAULT. Within one document, the system that provides the most services becomes the
// root `system_ref`, and only the services of another system carry their own. A tie takes the system
// declared first, so the same input always produces the same output.
//
// WHAT IT REPORTS RATHER THAN RESOLVES. Two declarations of one party (or of one context) that give
// the same key different values are a disagreement the duplication was hiding; the surviving
// declaration keeps the registry's value - the most complete one where there is no registry - and the
// value that is dropped is named with the document it came from. A party part that declares no
// service states a participation the migrated shape derives from services and can no longer hold, so
// that too is named. Nothing is invented and nothing is silently reconciled.
//
// WHAT IT REFUSES. Flow style (`parties: [...]`, `contexts: [...]` with entries), a party without an
// id, and one context id declared in two documents: each leaves its document untouched and is
// reported, because merging on a guess is the failure this tool exists to avoid.
//
// THE VERSION STAMP IS NOT TOUCHED. A model declares the base version of the schema LINE it is
// authored against - every model on the 2.7 line declared `2.7.0` across sixteen patch releases -
// and this rewrite keeps a model on the line it was already on.
//
// TEXT, NOT YAML. Inherited from the modules before it and load-bearing for the same reason: this
// tool has no runtime dependencies and its modules edit text so comments, key order and line endings
// survive. A parse/stringify round-trip would reformat every file it touches and bury the change.

const ARCH_FILE = /^(arch\.(yaml|yml)|[^/\\]+\.arch\.(yaml|yml))$/i;

/** `PRT###`, with the optional context prefix `party_ref` permits. */
const PARTY_REF = /^([a-z][a-z0-9-]*\.)?(PRT\d{3,})$/;

interface SourceLine {
  text: string;
  /** The line's own terminator, so a rewritten file keeps its CRLF/LF mix intact. */
  eol: string;
}

/**
 * A mapping key inside a list entry: the comment lines written above it, its own line, and every
 * deeper line under it.
 *
 * The comments belong to the block so that moving or dropping a key moves or drops what was written
 * about it - a comment left behind between two keys reads as a remark about the wrong one.
 */
interface KeyBlock {
  key: string;
  start: number;
  /** The `key:` line itself, at or after `start`. */
  keyLine: number;
  /** Exclusive. */
  end: number;
  /** The value written on the key's own line, when there is one (`contexts: []`). */
  inlineValue: string | null;
}

/** A `- ` item of a block sequence. */
interface ListEntry {
  /** Index of the `- ` line. */
  start: number;
  /** Exclusive; trailing blank lines are excluded. */
  end: number;
  /** First of the comment lines written directly above the entry, else `start`. */
  commentStart: number;
  /** Columns before the `-`. */
  indent: number;
  /** Column at which the entry's keys start. */
  keyColumn: number;
  keys: Map<string, KeyBlock>;
  keyOrder: string[];
}

interface ServiceDeclaration {
  entry: ListEntry;
  /** The party whose declaration this service was written under. */
  partyId: string;
}

interface ContextDeclaration {
  entry: ListEntry;
  id: string | null;
  name: string | null;
  partyId: string;
  services: ServiceDeclaration[];
}

interface PartyDeclaration {
  entry: ListEntry;
  id: string;
  name: string | null;
  contexts: ContextDeclaration[];
  /** True when the declaration carries `contexts:` with no entries. */
  emptyContexts: boolean;
}

interface ArchDocument {
  relativePath: string;
  absolutePath: string;
  lines: SourceLine[];
  /** The root `parties:` key, absent in a document already written in the root form. */
  partiesBlock: KeyBlock | null;
  parties: PartyDeclaration[];
  /** True when the document already declares contexts at its root. */
  hasRootContexts: boolean;
  /** True when something about the document's shape stops it from being rewritten. */
  refused: boolean;
}

function scanLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let position = 0;
  for (;;) {
    const newline = content.indexOf('\n', position);
    if (newline === -1) {
      lines.push({ text: content.slice(position), eol: '' });
      return lines;
    }
    const carriage = newline > position && content[newline - 1] === '\r';
    lines.push({ text: content.slice(position, carriage ? newline - 1 : newline), eol: carriage ? '\r\n' : '\n' });
    position = newline + 1;
  }
}

const isBlank = (text: string): boolean => text.trim() === '';
const isComment = (text: string): boolean => /^[ \t]*#/.test(text);
const indentOf = (text: string): number => /^[ \t]*/.exec(text)![0]!.length;

function unquote(value: string): string {
  const trimmed = value.replace(/[ \t]+#.*$/, '').trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2]! : trimmed;
}

/** The bare `PRT###` of a reference, or null when the value is not one. */
function partyIdOf(value: string): string | null {
  const match = PARTY_REF.exec(unquote(value));
  return match ? match[2]! : null;
}

/** A root-level key's block: its own line plus every deeper line, trailing blanks excluded. */
function readRootKey(lines: SourceLine[], key: string): KeyBlock | null {
  const pattern = new RegExp(`^${key}:[ \\t]*(.*)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index]!.text);
    if (!match) continue;
    let end = index + 1;
    while (end < lines.length) {
      const { text } = lines[end]!;
      if (!isBlank(text) && !isComment(text) && indentOf(text) === 0) break;
      end += 1;
    }
    while (end > index + 1 && (isBlank(lines[end - 1]!.text) || isComment(lines[end - 1]!.text))) end -= 1;
    const inline = match[1]!.replace(/[ \t]+#.*$/, '').trim();
    return { key, start: index, keyLine: index, end, inlineValue: inline === '' ? null : inline };
  }
  return null;
}

/**
 * The `- ` entries of the block sequence inside `range`, at its shallowest dash indentation.
 *
 * Returns null when the range holds a flow-style sequence, which the caller reports rather than
 * rewriting.
 */
function readEntries(lines: SourceLine[], from: number, to: number): ListEntry[] | null {
  let dashIndent: number | null = null;
  for (let index = from; index < to; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text) || isComment(text)) continue;
    const dash = /^([ \t]*)-([ \t]+)\S/.exec(text);
    if (!dash) continue;
    const indent = dash[1]!.length;
    if (dashIndent === null || indent < dashIndent) dashIndent = indent;
  }
  if (dashIndent === null) return [];

  const starts: number[] = [];
  for (let index = from; index < to; index += 1) {
    const dash = /^([ \t]*)-([ \t]+)(\S.*)$/.exec(lines[index]!.text);
    if (!dash || dash[1]!.length !== dashIndent) continue;
    if (dash[3]!.startsWith('{') || dash[3]!.startsWith('[')) return null;
    starts.push(index);
  }

  const entries: ListEntry[] = [];
  for (let position = 0; position < starts.length; position += 1) {
    const start = starts[position]!;
    let end = position + 1 < starts.length ? starts[position + 1]! : to;
    // Trailing blanks, and a comment run written above the NEXT entry, are not part of this one -
    // carry them along and the remark reappears under whatever the entry becomes.
    while (end > start + 1 && (isBlank(lines[end - 1]!.text) || isComment(lines[end - 1]!.text))) end -= 1;
    let commentStart = start;
    while (commentStart > from && isComment(lines[commentStart - 1]!.text)) commentStart -= 1;
    // A comment run directly above the FIRST entry may belong to the key line instead; it is kept
    // with the entry either way, which is where a reader of the rewritten file expects it.
    const dash = /^([ \t]*)-([ \t]+)(\S.*)$/.exec(lines[start]!.text)!;
    const entry: ListEntry = {
      start,
      end,
      commentStart,
      indent: dash[1]!.length,
      keyColumn: dash[1]!.length + 1 + dash[2]!.length,
      keys: new Map(),
      keyOrder: [],
    };
    readEntryKeys(lines, entry);
    entries.push(entry);
  }
  return entries;
}

/** Keys written at the entry's own key column, each with the block of deeper lines under it. */
function readEntryKeys(lines: SourceLine[], entry: ListEntry): void {
  const keyLines: { index: number; key: string; inline: string | null }[] = [];
  for (let index = entry.start; index < entry.end; index += 1) {
    const raw = lines[index]!.text;
    const text = index === entry.start ? ' '.repeat(entry.keyColumn) + raw.slice(entry.keyColumn) : raw;
    if (isBlank(text) || isComment(text)) continue;
    if (indentOf(text) !== entry.keyColumn) continue;
    const match = /^[ \t]*([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(text);
    if (!match) continue;
    const inline = match[2]!.replace(/[ \t]+#.*$/, '').trim();
    keyLines.push({ index, key: match[1]!, inline: inline === '' ? null : inline });
  }
  const starts = keyLines.map(({ index }, position) => {
    let start = index;
    const floor = position > 0 ? keyLines[position - 1]!.index + 1 : entry.start + 1;
    while (start > floor && isComment(lines[start - 1]!.text)) start -= 1;
    return start;
  });
  for (let position = 0; position < keyLines.length; position += 1) {
    const { index, key, inline } = keyLines[position]!;
    const end = position + 1 < keyLines.length ? starts[position + 1]! : entry.end;
    entry.keys.set(key, { key, start: starts[position]!, keyLine: index, end, inlineValue: inline });
    entry.keyOrder.push(key);
  }
}

/** The text of a key's block, used to tell two declarations of one key apart. */
function keyText(document: ArchDocument, block: KeyBlock): string {
  const lines: string[] = [];
  for (let index = block.start; index < block.end; index += 1) {
    const text = document.lines[index]!.text;
    if (isComment(text)) continue;
    lines.push(text.trim());
  }
  return lines.join(' ');
}

/** Every line of a range, re-indented by `shift` columns, with comments and blank lines kept. */
function renderRange(document: ArchDocument, from: number, to: number, shift: number): string[] {
  const out: string[] = [];
  for (let index = from; index < to; index += 1) {
    const { text } = document.lines[index]!;
    if (isBlank(text)) {
      out.push('');
      continue;
    }
    const indent = indentOf(text);
    out.push(' '.repeat(Math.max(0, indent + shift)) + text.slice(indent));
  }
  return out;
}

function parseDocument(absolutePath: string, relativePath: string, warnings: string[]): ArchDocument {
  const lines = scanLines(fs.readFileSync(absolutePath, 'utf8'));
  const document: ArchDocument = {
    relativePath,
    absolutePath,
    lines,
    partiesBlock: null,
    parties: [],
    hasRootContexts: readRootKey(lines, 'contexts') !== null,
    refused: false,
  };

  const partiesBlock = readRootKey(lines, 'parties');
  if (!partiesBlock) return document;
  if (partiesBlock.inlineValue !== null && partiesBlock.inlineValue !== '[]') {
    warnings.push(`${relativePath}: flow-style \`parties:\` - rewrite it in block style, then run the update again`);
    document.refused = true;
    return document;
  }
  document.partiesBlock = partiesBlock;

  const partyEntries = readEntries(lines, partiesBlock.start + 1, partiesBlock.end);
  if (partyEntries === null) {
    warnings.push(`${relativePath}: flow-style party entry - rewrite it in block style, then run the update again`);
    document.refused = true;
    return document;
  }

  for (const entry of partyEntries) {
    const idKey = entry.keys.get('id');
    const identifier = idKey?.inlineValue ? partyIdOf(idKey.inlineValue) : null;
    const nameKey = entry.keys.get('name');
    const name = nameKey?.inlineValue ? unquote(nameKey.inlineValue) : null;
    if (!identifier) {
      warnings.push(`${relativePath}: party ${name ? `"${name}"` : 'entry'} has no PRT### - left alone; give it an id first`);
      document.refused = true;
      continue;
    }

    const contextsKey = entry.keys.get('contexts');
    const party: PartyDeclaration = { entry, id: identifier, name, contexts: [], emptyContexts: false };
    if (contextsKey) {
      if (contextsKey.inlineValue !== null) {
        if (contextsKey.inlineValue === '[]') party.emptyContexts = true;
        else {
          warnings.push(`${relativePath}: flow-style \`contexts:\` under ${identifier} - rewrite it in block style, then run the update again`);
          document.refused = true;
          continue;
        }
      } else {
        const contextEntries = readEntries(lines, contextsKey.start + 1, contextsKey.end);
        if (contextEntries === null) {
          warnings.push(`${relativePath}: flow-style context entry under ${identifier} - rewrite it in block style, then run the update again`);
          document.refused = true;
          continue;
        }
        if (contextEntries.length === 0) party.emptyContexts = true;
        for (const contextEntry of contextEntries) {
          party.contexts.push(readContext(document, contextEntry, identifier));
        }
      }
    }
    document.parties.push(party);
  }

  return document;
}

function readContext(document: ArchDocument, entry: ListEntry, partyId: string): ContextDeclaration {
  const idKey = entry.keys.get('id');
  const nameKey = entry.keys.get('name');
  const context: ContextDeclaration = {
    entry,
    id: idKey?.inlineValue ? unquote(idKey.inlineValue) : null,
    name: nameKey?.inlineValue ? unquote(nameKey.inlineValue) : null,
    partyId,
    services: [],
  };
  const servicesKey = entry.keys.get('services');
  if (servicesKey && servicesKey.inlineValue === null) {
    const serviceEntries = readEntries(document.lines, servicesKey.start + 1, servicesKey.end) ?? [];
    for (const serviceEntry of serviceEntries) context.services.push({ entry: serviceEntry, partyId });
  }
  return context;
}

interface PartyOccurrence {
  document: ArchDocument;
  party: PartyDeclaration;
}

interface Analysis {
  documents: ArchDocument[];
  registry: ArchDocument | null;
  /** Party id in first-declaration order, with every document that declares it. */
  occurrences: Map<string, PartyOccurrence[]>;
  /** Party id, to the occurrence whose declaration text survives. */
  home: Map<string, PartyOccurrence>;
  /** Party id, to the document that declaration is written into - the registry when there is one. */
  homeDocument: Map<string, ArchDocument>;
  warnings: string[];
}

function analyse(absoluteDir: string): Analysis {
  const warnings: string[] = [];
  const documents: ArchDocument[] = [];

  for (const absolutePath of modelYamlFiles(absoluteDir)) {
    const relativePath = path.relative(absoluteDir, absolutePath).replace(/\\/g, '/');
    if (!ARCH_FILE.test(path.basename(relativePath))) continue;
    documents.push(parseDocument(absolutePath, relativePath, warnings));
  }

  const rootDocuments = documents.filter((document) => !document.relativePath.includes('/'));
  const registry = rootDocuments.find((document) => document.relativePath.toLowerCase().startsWith('arch.')) ?? rootDocuments[0] ?? null;
  if (rootDocuments.length > 1 && registry) {
    warnings.push(
      `${rootDocuments.map((document) => document.relativePath).join(', ')} all sit at the model root - party declarations gather in ${registry.relativePath}`,
    );
  }

  const occurrences = new Map<string, PartyOccurrence[]>();
  for (const document of documents) {
    for (const party of document.parties) {
      const list = occurrences.get(party.id) ?? [];
      list.push({ document, party });
      occurrences.set(party.id, list);
    }
  }

  const home = new Map<string, PartyOccurrence>();
  for (const [identifier, list] of occurrences) {
    const inRegistry = registry ? list.find((occurrence) => occurrence.document === registry) : undefined;
    if (inRegistry) {
      home.set(identifier, inRegistry);
      continue;
    }
    if (registry) {
      // The registry does not declare it yet: the most complete declaration moves there.
      home.set(identifier, mostComplete(list));
      continue;
    }
    const chosen = mostComplete(list);
    home.set(identifier, chosen);
    if (list.length > 1) {
      warnings.push(
        `${identifier} is declared in ${list.length} documents and the model has no root arch document - its declaration stays in ${chosen.document.relativePath}`,
      );
    }
  }

  const homeDocument = new Map<string, ArchDocument>();
  for (const [identifier, occurrence] of home) homeDocument.set(identifier, registry ?? occurrence.document);

  return { documents, registry, occurrences, home, homeDocument, warnings };
}

/** The declaration carrying the most keys; the first one on a tie. */
function mostComplete(list: PartyOccurrence[]): PartyOccurrence {
  let best = list[0]!;
  for (const occurrence of list) {
    const keys = occurrence.party.entry.keys.size;
    if (keys > best.party.entry.keys.size) best = occurrence;
  }
  return best;
}

interface Rewrite {
  document: ArchDocument;
  content: string;
  summary: string;
}

interface RewriteResult {
  rewrites: Rewrite[];
  warnings: string[];
  /** Documents whose contexts move to the root, so the version stamp travels with the change. */
  changed: boolean;
}

function computeRewrites(analysis: Analysis): RewriteResult {
  const warnings: string[] = [...analysis.warnings];
  const rewrites: Rewrite[] = [];

  const contextDocuments = new Map<string, string>();
  for (const document of analysis.documents) {
    for (const party of document.parties) {
      for (const context of party.contexts) {
        const identifier = context.id ?? (context.name ? `name::${context.name}` : null);
        if (!identifier) continue;
        const seen = contextDocuments.get(identifier);
        if (seen && seen !== document.relativePath) {
          warnings.push(
            `context ${context.id ?? context.name} is declared in both ${seen} and ${document.relativePath} - each document keeps its own declaration; merge them by hand`,
          );
        } else if (!seen) contextDocuments.set(identifier, document.relativePath);
      }
    }
  }

  for (const document of analysis.documents) {
    if (document.refused || !document.partiesBlock) continue;
    const rewrite = rewriteDocument(document, analysis, warnings);
    if (rewrite) rewrites.push(rewrite);
  }

  return { rewrites, warnings, changed: rewrites.length > 0 };
}

function rewriteDocument(document: ArchDocument, analysis: Analysis, warnings: string[]): Rewrite | null {
  const partiesBlock = document.partiesBlock!;
  const isRegistry = analysis.registry === document;

  // A party is written into exactly one document: the registry when the model has one, else the
  // document holding its most complete declaration. `staying` is what this document keeps, `movingIn`
  // what arrives from elsewhere, `leaving` every other declaration of a party written somewhere else.
  const movingIn: PartyOccurrence[] = isRegistry
    ? [...analysis.home.entries()]
        .filter(([identifier, occurrence]) => analysis.homeDocument.get(identifier) === document && occurrence.document !== document)
        .map(([, occurrence]) => occurrence)
    : [];
  const staying = document.parties.filter(
    (party) => analysis.homeDocument.get(party.id) === document && analysis.home.get(party.id)?.party === party,
  );
  const leaving = document.parties.filter((party) => !staying.includes(party));
  const contexts = document.parties.flatMap((party) => party.contexts);

  const nothingToDo =
    movingIn.length === 0 &&
    leaving.length === 0 &&
    contexts.length === 0 &&
    document.parties.every((party) => !party.emptyContexts);
  if (nothingToDo) return null;

  if (document.hasRootContexts && contexts.length > 0) {
    warnings.push(`${document.relativePath}: declares contexts at its root already - the nested ones are left alone`);
    return null;
  }

  const partyIndent = document.parties[0]?.entry.indent ?? 2;
  const partyLines: string[] = [];
  for (const party of staying) {
    if (partyLines.length > 0) partyLines.push('');
    partyLines.push(...renderParty(document, party, analysis, partyIndent, warnings));
  }
  for (const occurrence of movingIn) {
    if (partyLines.length > 0) partyLines.push('');
    partyLines.push(...renderParty(occurrence.document, occurrence.party, analysis, partyIndent, warnings));
  }

  for (const party of leaving) {
    // The surviving declaration carries its own comments with it wherever it is written; only a
    // declaration that disappears takes its comment with it, and that is worth saying out loud.
    if (analysis.home.get(party.id)?.party === party) continue;
    if (party.entry.commentStart >= party.entry.start) continue;
    warnings.push(
      `${document.relativePath}: the comment above ${party.id} goes with the declaration this document loses - ${party.id} is declared in ${analysis.homeDocument.get(party.id)!.relativePath}`,
    );
  }

  const { lines: contextLines, defaultSystem, ownReferences } = renderContexts(document, contexts, warnings);

  const replacement: string[] = [];
  if (partyLines.length > 0) {
    replacement.push('parties:');
    replacement.push(...partyLines);
  }
  if (contextLines.length > 0) {
    if (replacement.length > 0) replacement.push('');
    if (defaultSystem) replacement.push(`system_ref: ${defaultSystem}`);
    replacement.push('contexts:');
    replacement.push(...contextLines);
  }

  if (replacement.length === 0) {
    warnings.push(
      `${document.relativePath}: every declaration in it is written elsewhere and it declares no context - left alone, so the document still states something`,
    );
    return null;
  }

  const eol = document.lines[0]?.eol || '\n';
  const out: string[] = [];
  for (let index = 0; index < document.lines.length; index += 1) {
    if (index === partiesBlock.start) {
      for (const line of replacement) out.push(line + eol);
      index = partiesBlock.end - 1;
      continue;
    }
    const line = document.lines[index]!;
    out.push(line.text + line.eol);
  }

  const summary = [
    staying.length > 0 ? `${staying.length} party declaration(s) kept` : null,
    movingIn.length > 0 ? `${movingIn.length} moved in` : null,
    leaving.length > 0 ? `${leaving.length} removed` : null,
    contexts.length > 0 ? `${new Set(contexts.map((context) => context.id ?? context.name)).size} context(s) declared at the root` : null,
    defaultSystem ? `default system ${defaultSystem}` : null,
    ownReferences > 0 ? `${ownReferences} service(s) name their own` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return { document, content: out.join(''), summary };
}

/** A party declaration without its contexts, carrying every key its other declarations add. */
function renderParty(
  document: ArchDocument,
  party: PartyDeclaration,
  analysis: Analysis,
  targetIndent: number,
  warnings: string[],
): string[] {
  const shift = targetIndent - party.entry.indent;
  const lines: string[] = [];
  lines.push(...renderRange(document, party.entry.commentStart, party.entry.start, shift));

  for (const key of party.entry.keyOrder) {
    if (key === 'contexts') continue;
    const block = party.entry.keys.get(key)!;
    lines.push(...renderKeyOfEntry(document, block, shift));
  }

  const others = (analysis.occurrences.get(party.id) ?? []).filter((occurrence) => occurrence.party !== party);
  const seen = new Set(party.entry.keyOrder);
  for (const occurrence of others) {
    for (const key of occurrence.party.entry.keyOrder) {
      if (key === 'contexts') continue;
      const block = occurrence.party.entry.keys.get(key)!;
      if (!seen.has(key)) {
        seen.add(key);
        const otherShift = targetIndent - occurrence.party.entry.indent;
        lines.push(...renderKeyOfEntry(occurrence.document, block, otherShift));
        continue;
      }
      const here = party.entry.keys.get(key);
      if (!here) continue;
      if (keyText(document, here) !== keyText(occurrence.document, block)) {
        warnings.push(
          `party ${party.id}: \`${key}\` differs between ${document.relativePath} and ${occurrence.document.relativePath} - ${document.relativePath} is kept, the other value is dropped`,
        );
      }
    }
  }

  return lines;
}

/** A key's lines. The entry's own `- ` is part of the first key's line and is re-indented with it. */
function renderKeyOfEntry(document: ArchDocument, block: KeyBlock, shift: number): string[] {
  return renderRange(document, block.start, block.end, shift);
}

/**
 * The same lines with the key line turned into the entry's `- ` line, for an entry whose first key
 * is not the one the source wrote on its dash.
 */
function asFirstKey(lines: string[], keyLineOffset: number, indent: number, spacing: number): string[] {
  if (lines.length <= keyLineOffset) return lines;
  const out = [...lines];
  out[keyLineOffset] = ' '.repeat(Math.max(0, indent)) + '-' + ' '.repeat(spacing) + out[keyLineOffset]!.trimStart();
  return out;
}

interface RenderedContexts {
  lines: string[];
  defaultSystem: string | null;
  ownReferences: number;
}

function renderContexts(document: ArchDocument, contexts: ContextDeclaration[], warnings: string[]): RenderedContexts {
  if (contexts.length === 0) return { lines: [], defaultSystem: null, ownReferences: 0 };

  const servicesByParty = new Map<string, number>();
  for (const context of contexts) {
    for (const service of context.services) {
      servicesByParty.set(service.partyId, (servicesByParty.get(service.partyId) ?? 0) + 1);
    }
  }
  let defaultSystem: string | null = null;
  for (const [identifier, count] of servicesByParty) {
    if (defaultSystem === null || count > servicesByParty.get(defaultSystem)!) defaultSystem = identifier;
  }

  const groups = new Map<string, ContextDeclaration[]>();
  for (const context of contexts) {
    const identifier = context.id ?? `name::${context.name ?? ''}`;
    const list = groups.get(identifier) ?? [];
    list.push(context);
    groups.set(identifier, list);
  }

  const targetIndent = 2;
  const lines: string[] = [];
  let ownReferences = 0;

  for (const [, group] of groups) {
    const base = group[0]!;
    const shift = targetIndent - base.entry.indent;
    if (lines.length > 0) lines.push('');
    lines.push(...renderRange(document, base.entry.commentStart, base.entry.start, shift));

    const emitted: string[] = [];
    let first = true;
    const emitKey = (source: ContextDeclaration, key: string): void => {
      const block = source.entry.keys.get(key)!;
      const keyShift = targetIndent - source.entry.indent;
      const rendered =
        block.keyLine === source.entry.start || !first
          ? renderKeyOfEntry(document, block, keyShift)
          : asFirstKey(
              renderKeyOfEntry(document, block, keyShift),
              block.keyLine - block.start,
              targetIndent,
              base.entry.keyColumn - base.entry.indent - 1,
            );
      emitted.push(...rendered);
      first = false;
    };

    const seen = new Set<string>();
    for (const key of base.entry.keyOrder) {
      if (key === 'services') continue;
      seen.add(key);
      emitKey(base, key);
    }
    for (const extra of group.slice(1)) {
      for (const key of extra.entry.keyOrder) {
        if (key === 'services') continue;
        if (!seen.has(key)) {
          seen.add(key);
          emitKey(extra, key);
          continue;
        }
        const here = base.entry.keys.get(key);
        const there = extra.entry.keys.get(key)!;
        if (here && keyText(document, here) !== keyText(document, there)) {
          warnings.push(
            `${document.relativePath}: context ${base.id ?? base.name} declares \`${key}\` differently under ${base.partyId} and ${extra.partyId} - ${base.partyId}'s value is kept, the other is dropped`,
          );
        }
      }
      if (extra.services.length === 0) {
        warnings.push(
          `${document.relativePath}: ${extra.partyId} declares no service in context ${extra.id ?? extra.name} - a system's part in a context is derived from its services, so that participation is not carried over`,
        );
      }
    }

    const serviceIndent = (base.services[0]?.entry.indent ?? base.entry.keyColumn + 2) + shift;
    const serviceLines: string[] = [];
    for (const context of group) {
      for (const service of context.services) {
        const shiftService = serviceIndent - service.entry.indent;
        const needsOwn = defaultSystem !== null && service.partyId !== defaultSystem;
        if (needsOwn) ownReferences += 1;
        serviceLines.push(...renderService(document, service, shiftService, needsOwn ? service.partyId : null));
      }
    }

    lines.push(...emitted);
    if (serviceLines.length > 0) {
      lines.push(' '.repeat(base.entry.keyColumn + shift) + 'services:');
      lines.push(...serviceLines);
    }
  }

  return { lines, defaultSystem, ownReferences };
}

/** A service declaration, with `system_ref` written after its `kind` when it needs one. */
function renderService(document: ArchDocument, service: ServiceDeclaration, shift: number, systemRef: string | null): string[] {
  const entry = service.entry;
  const rendered = renderRange(document, entry.commentStart, entry.end, shift);
  if (!systemRef) return rendered;
  if (entry.keys.has('system_ref')) return rendered;

  const anchorKey = ['kind', 'name', 'id'].find((key) => entry.keys.has(key)) ?? entry.keyOrder[0];
  const anchor = anchorKey ? entry.keys.get(anchorKey)! : null;
  const offset = entry.commentStart;
  const insertAt = anchor ? anchor.end - offset : rendered.length;
  const line = ' '.repeat(Math.max(0, entry.keyColumn + shift)) + `system_ref: ${systemRef}`;
  return [...rendered.slice(0, insertAt), line, ...rendered.slice(insertAt)];
}

function buildPlan(blueprintDir: string): UpdatePlan {
  const absoluteDir = path.resolve(blueprintDir);
  const base = { sourceVersion: '2.8', targetVersion: '2.8', description: update.description };

  if (!fs.existsSync(absoluteDir)) {
    return { ...base, changes: [], warnings: [`Directory not found: ${absoluteDir}`] };
  }

  const analysis = analyse(absoluteDir);
  const { rewrites, warnings, changed } = computeRewrites(analysis);

  const changes: PlannedChange[] = rewrites.map((rewrite) => ({
    type: 'edit-yaml' as const,
    path: rewrite.document.relativePath,
    detail: rewrite.summary,
  }));

  if (!changed && analysis.documents.length > 0) {
    warnings.push('Every context is already declared once - nothing to invert.');
  }

  return { ...base, changes, warnings };
}

function applyPlan(blueprintDir: string): UpdateResult {
  const absoluteDir = path.resolve(blueprintDir);
  const plan = buildPlan(blueprintDir);
  if (plan.changes.length === 0) return { ...plan, applied: false, errors: [] };

  const errors: string[] = [];
  const analysis = analyse(absoluteDir);
  const { rewrites } = computeRewrites(analysis);

  for (const rewrite of rewrites) {
    try {
      fs.writeFileSync(rewrite.document.absolutePath, rewrite.content, 'utf8');
    } catch (error) {
      errors.push(`Failed to rewrite ${rewrite.document.relativePath}: ${(error as Error).message}`);
    }
  }

  return { ...plan, applied: errors.length === 0, errors };
}

export const update: SchemaUpdate = {
  sourceVersion: '2.8',
  targetVersion: '2.8',
  description:
    'Root-declared contexts (v2.8.x additive): every bounded context is declared once at its document root, every party once in the model root arch document, and a service names the system it belongs to through `system_ref` or the document default',
  plan: buildPlan,
  apply: applyPlan,
};
