import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';
import { modelFiles } from '../model-files.js';

// A context dependency says how it is connected, and since v2.8.33 it says so in the vocabulary the
// contract surface computes.
//
//   dependencies:                         dependencies:
//     - name: International                 - name: International
//       type: api                 =>          coupling: http
//
// A RENAME WITH A VALUE MAP, ON ONE LINE. `type` was free text and `coupling` is an enum of six -
// `http`, `message`, `rpc`, `inprocess`, `shareddata`, `scheduledtransfer` - the same six the
// contract surface derives from a model's own contract refs. That is the whole point of the move: a
// declared coupling and a derived one become comparable, where a free string was a second
// vocabulary for one fact and could be compared with nothing.
//
// WHAT IT WILL NOT DECIDE. Three kinds of site are left exactly as they are and reported:
//
//   · a value naming a MEDIUM rather than a coupling - `file`, `integration`, `email`. Which of the
//     six applies depends on whether a run moves the data or both ends address one store, and that
//     is a fact about the system, not about the string. Guessing would put a word in the model that
//     no one chose.
//   · an entry that already declares `coupling:`. Two statements of one fact, and which survives is
//     a judgement about which is right.
//   · flow form, whether the list (`dependencies: [{...}]`) or the entry (`- {name: X, type: api}`).
//     Splicing into an author's single line means rewriting it.
//
// WHAT IT DOES NOT DO AT ALL. Where the contracts already reach a pair, neither key should be
// declared: the contract surface carries the direction, the operations and the broker besides. This
// module cannot see that - it edits text and has no model - and it does not need to. The
// `restated-coupling` rule reports exactly that case and says to delete the declaration, so the
// mechanical half runs here and the judgement stays with the author, where it belongs.
//
// `type:` IS THE MOST COMMON KEY IN THE SCHEMA, so the walk is scoped rather than pattern-matched:
// only a `type:` at an entry's own property column, inside a block-form `dependencies:` region, is
// a dependency's. A `type:` one level deeper belongs to something nested and is never touched.
//
// AND `dependencies:` IS NOT ONLY A CONTEXT'S. A roadmap milestone has one too, holding milestone
// ids, and scoping by the key name alone reported four of them on the first real model this ran
// against - advice that would have been wrong to follow. So an entry qualifies only when it also
// declares `relationship:`, which the arch schema makes REQUIRED on a context dependency and which
// nothing else that spells the key has. The discriminator is the schema's own required list rather
// than a filename convention, so a context map in an unexpected file is still found and a milestone
// list in an expected one is still left alone.
//
// TEXT, NOT YAML. Inherited from the modules before it and load-bearing for the same reason: this
// tool has no runtime dependencies and edits text, so comments, key order, quoting and line endings
// survive. A trailing comment on the rewritten line survives with it.
//
// IDEMPOTENT BY CONSTRUCTION. A migrated entry has no `type:` to match, so a second run plans
// nothing.

const DEPENDENCIES_KEY = /^(\s*)dependencies:(.*)$/;
const LIST_OPENER = /^(\s*)-(\s+)(\S.*)$/;
/** Required on a context dependency, and declared by nothing else that spells the key. */
const RELATIONSHIP_LINE = /^\s*relationship:/;
/**
 * `type:` with its value, the gap before any trailing comment, and the comment, all kept apart.
 *
 * The gap is captured rather than re-emitted at a fixed width: an author who aligned a column of
 * comments did it on purpose, and normalising the spacing would move every one of them.
 */
const TYPE_LINE = /^(\s*)type:[ \t]*([^#]*?)([ \t]*)(#.*)?$/;
const COUPLING_LINE = /^\s*coupling:/;

/**
 * Free-string spellings this corpus and the schema's own examples use, mapped to the enum.
 *
 * Deliberately not exhaustive over everything an author might have written: a spelling nobody has
 * used is a guess, and this module reports what it cannot map rather than widening until it maps
 * everything.
 */
const COUPLING_FOR_TYPE: Readonly<Record<string, string>> = Object.freeze({
  api: 'http',
  http: 'http',
  https: 'http',
  rest: 'http',
  events: 'message',
  event: 'message',
  messaging: 'message',
  message: 'message',
  grpc: 'rpc',
  rpc: 'rpc',
  'shared-db': 'shareddata',
  shared_db: 'shareddata',
  shareddb: 'shareddata',
  database: 'shareddata',
});

interface SourceLine {
  text: string;
  /** The line's own terminator, so a rewritten file keeps its CRLF/LF mix intact. */
  eol: string;
}

function readLines(absolutePath: string): SourceLine[] {
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return raw.split('\n').map((text, index, all) => {
    const last = index === all.length - 1;
    if (text.endsWith('\r')) return { text: text.slice(0, -1), eol: '\r\n' };
    return { text, eol: last ? '' : '\n' };
  });
}

function joinLines(lines: SourceLine[]): string {
  return lines.map((line) => line.text + line.eol).join('');
}

function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

function isComment(text: string): boolean {
  return text.trimStart().startsWith('#');
}

/** Exclusive end of the block a key opens: the first line at or left of its own indent. */
function regionEnd(lines: SourceLine[], keyIndex: number, keyIndent: number): number {
  for (let index = keyIndex + 1; index < lines.length; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text) || isComment(text)) continue;
    if (indentOf(text) <= keyIndent) return index;
  }
  return lines.length;
}

interface Rewrite {
  index: number;
  line: SourceLine;
  from: string;
  to: string;
}

/** One dependency entry: the lines from its opener to the next opener at the same indent. */
interface Entry {
  openerIndex: number;
  endIndex: number;
  /** Column at which the entry's own keys sit - after the `- `. */
  propertyColumn: number;
}

function entriesOf(lines: SourceLine[], from: number, to: number): Entry[] {
  const entries: Entry[] = [];
  let openerIndent: number | null = null;
  for (let index = from; index < to; index += 1) {
    const match = lines[index]!.text.match(LIST_OPENER);
    if (!match) continue;
    const indent = match[1]!.length;
    if (openerIndent === null) openerIndent = indent;
    if (indent !== openerIndent) continue;
    const propertyColumn = indent + 1 + match[2]!.length;
    if (entries.length > 0) entries[entries.length - 1]!.endIndex = index;
    entries.push({ openerIndex: index, endIndex: to, propertyColumn });
  }
  return entries;
}

/** Every dependency `type:` in one file planned as a rewrite, plus what the module declines to touch. */
function planFile(lines: SourceLine[], relativePath: string): { rewrites: Rewrite[]; warnings: string[] } {
  const rewrites: Rewrite[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.text.match(DEPENDENCIES_KEY);
    if (!match) continue;
    const keyIndent = match[1]!.length;
    if (match[2]!.trim() !== '') {
      // A flow list with no `type:` in it has nothing for this module to say - and a milestone's
      // `dependencies: [MS001]` is exactly that, so silence here is what keeps the advice true.
      if (/\btype\s*:/.test(match[2]!)) {
        warnings.push(
          `${relativePath}:${index + 1}: \`dependencies:\` is written in flow form - rewrite \`type:\` as \`coupling:\` by hand; the list is left alone`,
        );
      }
      continue;
    }
    const end = regionEnd(lines, index, keyIndent);

    for (const entry of entriesOf(lines, index + 1, end)) {
      const opener = lines[entry.openerIndex]!.text;
      if (opener.slice(entry.propertyColumn).trimStart().startsWith('{')) {
        warnings.push(
          `${relativePath}:${entry.openerIndex + 1}: the entry is written in flow form - rewrite \`type:\` as \`coupling:\` by hand; the entry is left alone`,
        );
        continue;
      }

      let typeIndex: number | null = null;
      let declaresCoupling = false;
      let declaresRelationship = false;
      for (let line = entry.openerIndex; line < entry.endIndex; line += 1) {
        const text = lines[line]!.text;
        if (isBlank(text) || isComment(text)) continue;
        // The opener carries its first key after the dash; every other key sits at the column.
        const column = line === entry.openerIndex ? entry.propertyColumn : indentOf(text);
        if (column !== entry.propertyColumn) continue;
        const body = line === entry.openerIndex ? ' '.repeat(entry.propertyColumn) + text.slice(entry.propertyColumn) : text;
        if (COUPLING_LINE.test(body)) declaresCoupling = true;
        else if (RELATIONSHIP_LINE.test(body)) declaresRelationship = true;
        else if (TYPE_LINE.test(body)) typeIndex = line;
      }

      if (typeIndex === null || !declaresRelationship) continue;

      const typeMatch = (lines[typeIndex]!.text.match(TYPE_LINE) ??
        (' '.repeat(entry.propertyColumn) + lines[typeIndex]!.text.slice(entry.propertyColumn)).match(TYPE_LINE))!;
      const authored = typeMatch[2]!.trim().replace(/^['"]|['"]$/g, '');
      if (authored === '') continue;

      if (declaresCoupling) {
        warnings.push(
          `${relativePath}:${typeIndex + 1}: the entry declares \`coupling:\` as well as \`type: ${authored}\` - two statements of one fact; delete the one that is wrong by hand`,
        );
        continue;
      }

      const mapped = COUPLING_FOR_TYPE[authored.toLowerCase()];
      if (!mapped) {
        warnings.push(
          `${relativePath}:${typeIndex + 1}: \`type: ${authored}\` names a medium rather than a coupling - which of the six applies is a decision only an author can make; the entry is left alone`,
        );
        continue;
      }

      const original = lines[typeIndex]!;
      const isOpener = typeIndex === entry.openerIndex;
      const prefix = isOpener ? original.text.slice(0, entry.propertyColumn) : ' '.repeat(indentOf(original.text));
      const comment = typeMatch[4] ? `${typeMatch[3]}${typeMatch[4]}` : '';
      rewrites.push({
        index: typeIndex,
        line: { text: `${prefix}coupling: ${mapped}${comment}`, eol: original.eol },
        from: authored,
        to: mapped,
      });
    }

    index = end - 1;
  }

  return { rewrites, warnings };
}

interface FileAnalysis {
  absolutePath: string;
  relativePath: string;
  rewritten: string;
  count: number;
  values: Map<string, number>;
}

function analyse(blueprintDir: string): { files: FileAnalysis[]; changes: PlannedChange[]; warnings: string[] } {
  const files: FileAnalysis[] = [];
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(blueprintDir) || !fs.statSync(blueprintDir).isDirectory()) return { files, changes, warnings };
  const { yaml, prose } = modelFiles(blueprintDir);

  // A model's own prose is not rewritten - a guide's sentence is not a declaration this tool can
  // retarget - but one naming the superseded key is stale the moment the migration lands.
  for (const absolutePath of prose) {
    const text = fs.readFileSync(absolutePath, 'utf8');
    const stale = text.match(/\bdependency\.type\b/g);
    if (!stale) continue;
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    warnings.push(`${relativePath}: ${stale.length} mention(s) of \`dependency.type\` in prose - rewrite by hand`);
  }

  for (const absolutePath of yaml) {
    const original = fs.readFileSync(absolutePath, 'utf8');
    if (!original.includes('dependencies:')) continue;

    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    const lines = readLines(absolutePath);
    const { rewrites, warnings: fileWarnings } = planFile(lines, relativePath);
    warnings.push(...fileWarnings);
    if (rewrites.length === 0) continue;

    const out = lines.slice();
    for (const rewrite of rewrites) out[rewrite.index] = rewrite.line;
    const text = joinLines(out);
    if (text === original) continue;

    const values = new Map<string, number>();
    for (const rewrite of rewrites) {
      const key = `${rewrite.from} -> ${rewrite.to}`;
      values.set(key, (values.get(key) ?? 0) + 1);
    }
    files.push({ absolutePath, relativePath, rewritten: text, count: rewrites.length, values });

    const detail = [...values]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => `${key} (${count})`)
      .join(', ');
    changes.push({ type: 'edit-yaml', path: relativePath, detail: `${rewrites.length} dependency type(s): ${detail}` });
  }

  return { files, changes, warnings };
}

function buildPlan(blueprintDir: string): UpdatePlan {
  const analysis = analyse(blueprintDir);
  return {
    sourceVersion: '2.8',
    targetVersion: '2.8',
    description: update.description,
    changes: analysis.changes,
    warnings: analysis.warnings,
  };
}

function applyPlan(blueprintDir: string): UpdateResult {
  const analysis = analyse(blueprintDir);
  const plan: UpdatePlan = {
    sourceVersion: '2.8',
    targetVersion: '2.8',
    description: update.description,
    changes: analysis.changes,
    warnings: analysis.warnings,
  };
  const errors: string[] = [];
  if (analysis.changes.length === 0) return { ...plan, applied: true, errors };
  try {
    for (const file of analysis.files) fs.writeFileSync(file.absolutePath, file.rewritten, 'utf8');
  } catch (error) {
    errors.push(`write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...plan, applied: errors.length === 0, errors };
}

export const update: SchemaUpdate = {
  sourceVersion: '2.8',
  targetVersion: '2.8',
  description: "A context dependency's free-string `type:` becomes the typed `coupling:`",
  plan: buildPlan,
  apply: applyPlan,
};
