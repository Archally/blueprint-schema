import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';
import { modelYamlFiles } from '../model-files.js';

// A business decision, an assumption and a KPI name the region of the problem space they belong to,
// and since v2.8.45 they name it with a key that says so.
//
//   business_decisions:                   business_decisions:
//     - id: BD001                           - id: BD001
//       bounded_context_ref: orders  =>       domain_scope: orders
//
// A RENAME WITHOUT A VALUE MAP, ON ONE LINE. The type is unchanged - `scope_prefix`, a kebab-case
// slug - and so is every value, every entry's optionality and, on a business decision, the fact that
// the key is required. What changes is which of two things the key name states. `bounded_context_ref`
// elsewhere in the schema takes a typed `BC###` id: an arch context declares its own, an
// inter-context dependency names its target, a competency question names the one context whose
// knowledge boundary it defines. On these three it took a slug instead, so one key name carried two
// types and a value legal in one place was rejected in the other. `domain_scope` names the slug, and
// `bounded_context_ref` is left meaning a reference into the solution space and nothing else.
//
// WHAT IT WILL NOT DECIDE. Three kinds of site are left exactly as they are and reported:
//
//   · an entry that already declares `domain_scope:`. Two statements of one fact, and which survives
//     is a judgement about which is right.
//   · a value that is not a bare kebab-case slug - a `BC###` id, or a scope-qualified one. The key
//     it would move to accepts neither, so rewriting the key would leave the model invalid under a
//     name the author never chose. Which context the entry means, and whether the intent was a
//     reference rather than a scope, is a fact about the model.
//   · flow form, whether the collection (`kpis: [{...}]`) or the entry (`- {id: KPI001, ...}`).
//     Splicing into an author's single line means rewriting it.
//
// WHAT IT DOES NOT DO AT ALL. It rewrites no prose. `bounded_context_ref` is a live key on three
// other constructs, so a sentence naming it is as likely to be about an arch dependency as about a
// KPI, and a matcher cannot tell which. Reporting every mention would report mostly correct ones.
//
// `bounded_context_ref:` IS A KEY ON FIVE CONSTRUCTS, so the walk is scoped rather than
// pattern-matched. Two guards, and each is the schema's own statement rather than a filename
// convention:
//
//   · the collection key sits at COLUMN 0. `business_decisions`, `assumptions` and `kpis` are root
//     properties of their documents. `assumptions:` is also an ADR's list of `ASM###` refs nested
//     inside `decisions[].rationale`, and that one is indented and holds strings, not entries.
//   · the entry declares `id:` at its own property column, which all three schemas make REQUIRED.
//
// A `bounded_context_ref:` one level deeper than the entry's own keys belongs to something nested
// and is never touched - which is also what keeps the key's name inside a description string from
// being read as a declaration.
//
// TEXT, NOT YAML. Inherited from the modules before it and load-bearing for the same reason: this
// tool has no runtime dependencies and edits text, so comments, key order, quoting and line endings
// survive. A trailing comment on the rewritten line survives with it.
//
// IDEMPOTENT BY CONSTRUCTION. A migrated entry has no `bounded_context_ref:` to match, so a second
// run plans nothing.

const COLLECTION_KEY = /^(business_decisions|assumptions|kpis):(.*)$/;
const LIST_OPENER = /^(\s*)-(\s+)(\S.*)$/;
/** Required on all three entries, and declared by nothing the nested `assumptions:` list holds. */
const ID_LINE = /^\s*id:/;
/**
 * `bounded_context_ref:` with its value, the gap before any trailing comment, and the comment, all
 * kept apart.
 *
 * The gap is captured rather than re-emitted at a fixed width: an author who aligned a column of
 * comments did it on purpose, and normalising the spacing would move every one of them.
 */
const REF_LINE = /^(\s*)bounded_context_ref:[ \t]*([^#]*?)([ \t]*)(#.*)?$/;
const SCOPE_LINE = /^\s*domain_scope:/;
/** What `$defs/scope_prefix` accepts, and therefore what `domain_scope` accepts. */
const SCOPE_SLUG = /^[a-z][a-z0-9-]*$/;

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

/** Exclusive end of the block a column-0 key opens: the first line back at column 0. */
function regionEnd(lines: SourceLine[], keyIndex: number): number {
  for (let index = keyIndex + 1; index < lines.length; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text) || isComment(text)) continue;
    if (indentOf(text) === 0) return index;
  }
  return lines.length;
}

interface Rewrite {
  index: number;
  line: SourceLine;
  value: string;
}

/** One entry: the lines from its opener to the next opener at the same indent. */
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

/** Every BCC `bounded_context_ref:` in one file planned as a rewrite, plus what it declines to touch. */
function planFile(
  lines: SourceLine[],
  relativePath: string,
): { rewrites: Rewrite[]; warnings: string[] } {
  const rewrites: Rewrite[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.text.match(COLLECTION_KEY);
    if (!match) continue;
    const collection = match[1]!;
    if (match[2]!.trim() !== '') {
      // A flow collection with no ref in it has nothing for this module to say, and silence there
      // is what keeps the advice true.
      if (/\bbounded_context_ref\s*:/.test(match[2]!)) {
        warnings.push(
          `${relativePath}:${index + 1}: \`${collection}:\` is written in flow form - rewrite \`bounded_context_ref:\` as \`domain_scope:\` by hand; the list is left alone`,
        );
      }
      continue;
    }
    const end = regionEnd(lines, index);

    for (const entry of entriesOf(lines, index + 1, end)) {
      const opener = lines[entry.openerIndex]!.text;
      if (opener.slice(entry.propertyColumn).trimStart().startsWith('{')) {
        if (/\bbounded_context_ref\s*:/.test(opener)) {
          warnings.push(
            `${relativePath}:${entry.openerIndex + 1}: the entry is written in flow form - rewrite \`bounded_context_ref:\` as \`domain_scope:\` by hand; the entry is left alone`,
          );
        }
        continue;
      }

      let refIndex: number | null = null;
      let declaresScope = false;
      let declaresId = false;
      for (let line = entry.openerIndex; line < entry.endIndex; line += 1) {
        const text = lines[line]!.text;
        if (isBlank(text) || isComment(text)) continue;
        // The opener carries its first key after the dash; every other key sits at the column.
        const column = line === entry.openerIndex ? entry.propertyColumn : indentOf(text);
        if (column !== entry.propertyColumn) continue;
        const body =
          line === entry.openerIndex
            ? ' '.repeat(entry.propertyColumn) + text.slice(entry.propertyColumn)
            : text;
        if (SCOPE_LINE.test(body)) declaresScope = true;
        else if (ID_LINE.test(body)) declaresId = true;
        else if (REF_LINE.test(body)) refIndex = line;
      }

      if (refIndex === null || !declaresId) continue;

      const refMatch = (lines[refIndex]!.text.match(REF_LINE) ??
        (' '.repeat(entry.propertyColumn) + lines[refIndex]!.text.slice(entry.propertyColumn)).match(
          REF_LINE,
        ))!;
      const authored = refMatch[2]!.trim().replace(/^['"]|['"]$/g, '');
      if (authored === '') continue;

      if (declaresScope) {
        warnings.push(
          `${relativePath}:${refIndex + 1}: the entry declares \`domain_scope:\` as well as \`bounded_context_ref: ${authored}\` - two statements of one fact; delete the one that is wrong by hand`,
        );
        continue;
      }

      if (!SCOPE_SLUG.test(authored)) {
        warnings.push(
          `${relativePath}:${refIndex + 1}: \`bounded_context_ref: ${authored}\` is not a kebab-case scope slug, which is all \`domain_scope\` accepts - which scope this entry belongs to is a decision only an author can make; the entry is left alone`,
        );
        continue;
      }

      const original = lines[refIndex]!;
      const isOpener = refIndex === entry.openerIndex;
      const prefix = isOpener
        ? original.text.slice(0, entry.propertyColumn)
        : ' '.repeat(indentOf(original.text));
      const comment = refMatch[4] ? `${refMatch[3]}${refMatch[4]}` : '';
      const quoted = refMatch[2]!.trim();
      rewrites.push({
        index: refIndex,
        line: { text: `${prefix}domain_scope: ${quoted}${comment}`, eol: original.eol },
        value: authored,
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
}

function analyse(blueprintDir: string): {
  files: FileAnalysis[];
  changes: PlannedChange[];
  warnings: string[];
} {
  const files: FileAnalysis[] = [];
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(blueprintDir) || !fs.statSync(blueprintDir).isDirectory()) {
    return { files, changes, warnings };
  }

  for (const absolutePath of modelYamlFiles(blueprintDir)) {
    const original = fs.readFileSync(absolutePath, 'utf8');
    if (!original.includes('bounded_context_ref')) continue;

    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    const lines = readLines(absolutePath);
    const { rewrites, warnings: fileWarnings } = planFile(lines, relativePath);
    warnings.push(...fileWarnings);
    if (rewrites.length === 0) continue;

    const out = lines.slice();
    for (const rewrite of rewrites) out[rewrite.index] = rewrite.line;
    const text = joinLines(out);
    if (text === original) continue;

    files.push({ absolutePath, relativePath, rewritten: text, count: rewrites.length });

    const values = new Map<string, number>();
    for (const rewrite of rewrites) values.set(rewrite.value, (values.get(rewrite.value) ?? 0) + 1);
    const detail = [...values]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => `${value} (${count})`)
      .join(', ');
    changes.push({
      type: 'edit-yaml',
      path: relativePath,
      detail: `${rewrites.length} bounded_context_ref -> domain_scope: ${detail}`,
    });
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
  description:
    "A business decision's, assumption's and KPI's `bounded_context_ref:` becomes `domain_scope:`",
  plan: buildPlan,
  apply: applyPlan,
};
