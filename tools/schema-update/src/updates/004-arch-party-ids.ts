import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// A party is a PARTIAL CLASS: `arch.yaml` and `organization.yaml` each declare a part, neither is
// authoritative, and `PRT###` is the identifier that says the parts are one thing. Arch documents
// require `parties` at their root, so splitting a context map across slice folders COMPELS
// re-declaring the party — and without a shared id each re-declaration is a separate node.
//
// This migration writes the ids. It does not merge anything: merging is the model builder's job and
// happens on the id this puts there.
//
//   parties:                              parties:
//     - name: Acme                =>        - id: PRT001
//       env: production                       name: Acme
//                                             env: production
//
// Identity is EXACT. An arch party adopts an org party's id only when the names match exactly —
// "PrestaShop" and "PrestaShop SA" are two identifiers, therefore two parties. Anything looser would
// be inference, and inference belongs nowhere near a file rewrite.
//
// TEXT, NOT YAML. This tool has no runtime dependencies and its modules edit text so that comments,
// key order and line endings survive; a parse/stringify round-trip would reformat every file it
// touches and bury the change. Block style is required — flow style is reported, never rewritten.

const ARCH_FILE = /^(arch\.(yaml|yml)|[^/\\]+\.arch\.(yaml|yml))$/i;
const ORG_FILE = /^((org|organization)\.(yaml|yml)|[^/\\]+\.(org|organization)\.(yaml|yml))$/i;

/** `PRT###` as a standalone token — not part of a longer word or a dotted ref's tail. */
const PRT_TOKEN = /(?<![A-Za-z0-9_-])PRT(\d{3})(?![A-Za-z0-9_-])/g;

interface SourceLine {
  text: string;
  /** Offset of the line's first character. */
  start: number;
  /** The line's own terminator, so an insertion keeps the file's CRLF/LF mix intact. */
  eol: string;
}

interface PartyEntry {
  /** Index into the file's line array. */
  lineIndex: number;
  /** Indentation before the `-`. */
  dashIndent: string;
  /** Whitespace between the `-` and the first key — preserved so the rewritten keys stay aligned. */
  dashSpacing: string;
  /** Column at which the entry's keys start (after `- `). */
  keyColumn: number;
  /** Text of the first key, which sits on the `- ` line itself. */
  firstKeyText: string;
  name: string | null;
  id: string | null;
}

interface ArchFile {
  relativePath: string;
  absolutePath: string;
  lines: SourceLine[];
  entries: PartyEntry[];
}

function scanLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let position = 0;
  for (;;) {
    const newline = content.indexOf('\n', position);
    if (newline === -1) {
      lines.push({ text: content.slice(position), start: position, eol: '' });
      return lines;
    }
    const carriage = newline > position && content[newline - 1] === '\r';
    lines.push({
      text: content.slice(position, carriage ? newline - 1 : newline),
      start: position,
      eol: carriage ? '\r\n' : '\n',
    });
    position = newline + 1;
  }
}

function walkYamlFiles(directory: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walkYamlFiles(fullPath));
    else if (/\.(yaml|yml)$/i.test(entry.name)) results.push(fullPath);
  }
  return results;
}

/**
 * Party entries of the root-level `parties:` block, or null when the file has no such block.
 *
 * Returns `null` for flow style too — the caller reports it rather than guessing at a rewrite.
 */
function readPartyEntries(lines: SourceLine[], warnings: string[], relativePath: string): PartyEntry[] | null {
  const blockIndex = lines.findIndex((line) => /^parties:[ \t]*(#.*)?$/.test(line.text));
  if (blockIndex === -1) {
    // `parties: [ ... ]` or `parties: {` — root key present but not block style.
    if (lines.some((line) => /^parties:[ \t]*\S/.test(line.text))) {
      warnings.push(`${relativePath}: flow-style \`parties:\` — add \`id: PRT###\` by hand`);
    }
    return null;
  }

  const entries: PartyEntry[] = [];
  let entryIndent: number | null = null;
  let current: PartyEntry | null = null;

  for (let index = blockIndex + 1; index < lines.length; index += 1) {
    const { text } = lines[index]!;
    if (text.trim() === '' || /^[ \t]*#/.test(text)) continue;
    if (/^\S/.test(text)) break; // next root-level key ends the block

    const dashMatch = /^([ \t]*)-([ \t]+)(\S.*)$/.exec(text);
    if (dashMatch) {
      const indent = dashMatch[1]!.length;
      if (entryIndent === null) entryIndent = indent;
      if (indent === entryIndent) {
        if (dashMatch[3]!.startsWith('{')) {
          warnings.push(`${relativePath}: flow-style party entry — add \`id: PRT###\` by hand`);
          return null;
        }
        current = {
          lineIndex: index,
          dashIndent: dashMatch[1]!,
          dashSpacing: dashMatch[2]!,
          keyColumn: indent + 1 + dashMatch[2]!.length,
          firstKeyText: dashMatch[3]!,
          name: null,
          id: null,
        };
        entries.push(current);
        readKey(current, dashMatch[3]!);
        continue;
      }
    }
    if (!current) continue;
    // A key of the current entry sits exactly at its key column; anything deeper is nested data.
    const keyMatch = /^([ \t]*)(\S.*)$/.exec(text);
    if (keyMatch && keyMatch[1]!.length === current.keyColumn) readKey(current, keyMatch[2]!);
  }

  return entries;
}

function readKey(entry: PartyEntry, keyText: string): void {
  const idMatch = /^id:[ \t]*["']?(PRT\d{3})["']?[ \t]*(#.*)?$/.exec(keyText);
  if (idMatch) {
    entry.id = idMatch[1]!;
    return;
  }
  const nameMatch = /^name:[ \t]*(.+?)[ \t]*$/.exec(keyText);
  if (nameMatch) entry.name = unquote(nameMatch[1]!);
}

function unquote(value: string): string {
  const trimmed = value.replace(/[ \t]+#.*$/, '').trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2]! : trimmed;
}

/**
 * Gap-unaware `max + 1`, the same rule as `allocateNextId` in the `next-id` unit (which the vertical
 * CLIs and the MCP share). Restated here rather than imported: no shared unit reaches into another,
 * and nothing would gate two port jobs keeping the same relative shape. Equality with
 * `bp next-id PRT --project <id>` is verified against the corpus, not assumed.
 */
function makeAllocator(used: Set<string>): () => string {
  let highest = 0;
  for (const id of used) {
    const match = /^PRT(\d{3})$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return () => {
    highest += 1;
    return `PRT${String(highest).padStart(3, '0')}`;
  };
}

interface Analysis {
  archFiles: ArchFile[];
  /** Party name → the id it will carry, in first-declaration order. */
  assignments: Map<string, string>;
  adopted: Set<string>;
  warnings: string[];
}

function analyse(absoluteDir: string): Analysis {
  const warnings: string[] = [];
  const archFiles: ArchFile[] = [];
  const orgIdByName = new Map<string, string>();
  const ambiguousOrgNames = new Set<string>();
  const usedIds = new Set<string>();

  for (const absolutePath of walkYamlFiles(absoluteDir)) {
    const relativePath = path.relative(absoluteDir, absolutePath).replace(/\\/g, '/');
    const content = fs.readFileSync(absolutePath, 'utf8');

    // Every PRT### anywhere in the model, so allocation cannot collide with a reference either.
    for (const match of content.matchAll(PRT_TOKEN)) usedIds.add(`PRT${match[1]}`);

    const fileName = path.basename(relativePath);
    const isArch = ARCH_FILE.test(fileName);
    const isOrg = ORG_FILE.test(fileName);
    if (!isArch && !isOrg) continue;

    const lines = scanLines(content);
    const entries = readPartyEntries(lines, warnings, relativePath);
    if (!entries) continue;

    if (isOrg) {
      for (const entry of entries) {
        if (!entry.name || !entry.id) continue;
        const existing = orgIdByName.get(entry.name);
        // Two org parties sharing a name make adoption ambiguous — refuse both, report, allocate fresh.
        if (existing && existing !== entry.id) ambiguousOrgNames.add(entry.name);
        else orgIdByName.set(entry.name, entry.id);
      }
      continue;
    }
    archFiles.push({ relativePath, absolutePath, lines, entries });
  }

  for (const name of ambiguousOrgNames) {
    orgIdByName.delete(name);
    warnings.push(`org declares "${name}" with more than one PRT### — allocating a fresh id instead of adopting`);
  }

  const allocate = makeAllocator(usedIds);
  const assignments = new Map<string, string>();
  const adopted = new Set<string>();

  // Adoption first, so a fresh allocation can never take an id an org part already owns.
  for (const file of archFiles) {
    for (const entry of file.entries) {
      if (!entry.name || entry.id || assignments.has(entry.name)) continue;
      const orgId = orgIdByName.get(entry.name);
      if (orgId) {
        assignments.set(entry.name, orgId);
        adopted.add(entry.name);
      }
    }
  }
  for (const file of archFiles) {
    for (const entry of file.entries) {
      if (!entry.name || entry.id || assignments.has(entry.name)) continue;
      assignments.set(entry.name, allocate());
    }
  }

  return { archFiles, assignments, adopted, warnings };
}

function buildPlan(blueprintDir: string): UpdatePlan {
  const absoluteDir = path.resolve(blueprintDir);
  const base = { sourceVersion: '2.7', targetVersion: '2.7', description: update.description };

  if (!fs.existsSync(absoluteDir)) {
    return { ...base, changes: [], warnings: [`Directory not found: ${absoluteDir}`] };
  }

  const { archFiles, assignments, adopted, warnings } = analyse(absoluteDir);
  const changes: PlannedChange[] = [];

  for (const file of archFiles) {
    for (const entry of file.entries) {
      if (entry.id || !entry.name) continue;
      const id = assignments.get(entry.name)!;
      changes.push({
        type: 'edit-yaml',
        path: file.relativePath,
        detail: `party "${entry.name}" → id: ${id}${adopted.has(entry.name) ? ' (adopted from the org part)' : ''}`,
      });
    }
    for (const entry of file.entries) {
      if (!entry.name) warnings.push(`${file.relativePath}: party entry without a name — skipped`);
    }
  }

  if (changes.length === 0) {
    warnings.push('Every arch party already carries a PRT### — nothing to assign.');
  }

  return { ...base, changes, warnings };
}

function applyPlan(blueprintDir: string): UpdateResult {
  const absoluteDir = path.resolve(blueprintDir);
  const plan = buildPlan(blueprintDir);
  if (plan.changes.length === 0) return { ...plan, applied: false, errors: [] };

  const errors: string[] = [];
  const { archFiles, assignments } = analyse(absoluteDir);

  for (const file of archFiles) {
    const pending = file.entries.filter((entry) => !entry.id && entry.name);
    if (pending.length === 0) continue;
    try {
      let content = fs.readFileSync(file.absolutePath, 'utf8');
      // Descending offset order, so each splice leaves earlier offsets valid.
      for (const entry of [...pending].sort((a, b) => b.lineIndex - a.lineIndex)) {
        const line = file.lines[entry.lineIndex]!;
        const id = assignments.get(entry.name!)!;
        // The id becomes the entry's first key, so it carries the `- `; the displaced key moves to
        // its own line at the SAME column, or the mapping's keys stop aligning and the YAML breaks.
        const replacement =
          `${entry.dashIndent}-${entry.dashSpacing}id: ${id}${line.eol}` +
          `${' '.repeat(entry.keyColumn)}${entry.firstKeyText}`;
        content =
          content.slice(0, line.start) + replacement + content.slice(line.start + line.text.length);
      }
      fs.writeFileSync(file.absolutePath, content, 'utf8');
    } catch (error) {
      errors.push(`Failed to edit ${file.relativePath}: ${(error as Error).message}`);
    }
  }

  return { ...plan, applied: errors.length === 0, errors };
}

export const update: SchemaUpdate = {
  sourceVersion: '2.7',
  targetVersion: '2.7',
  description:
    'Arch party ids (v2.7.x additive): give every arch party a PRT###, adopting the org party id on an exact name match, so arch and org declarations reconcile to one node — the prerequisite for v2.8 making party.id REQUIRED',
  plan: buildPlan,
  apply: applyPlan,
};
