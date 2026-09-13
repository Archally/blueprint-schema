import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// An activity says where it goes next, and since v2.8.23 it can also say what takes each branch.
//
//   next_activities: [orders.PA011]          =>   next: [{to: orders.PA011}]
//
//   next_activities: [orders.PA011,               next:
//                     orders.PA012]                 - to: orders.PA011
//                                                   - to: orders.PA012
//
// TWO OUTPUT SHAPES, AND THE SPLIT IS MEASURED. A single successor stays on one line, because a
// condition on a lone branch chooses nothing and expanding it would turn a one-line edit into three
// for no gain. A fork expands to block style, because a fork is exactly where a condition belongs
// and an author adding one to a flow mapping has to restructure it first. Measured across the
// corpus 2026-09-13: 209 single successors against 13 forks, so the expanded shape lands on the 6%
// that will use it.
//
// IT DOES NOT INVENT A CONDITION. The older key carries none, so every entry migrates to a bare
// `to:` and the author adds the reason later, or never. A migration that guessed at conditions
// would put words in the model's mouth that no one wrote, and the drawing would then label an arrow
// with them.
//
// LOSSLESS. `next_activities` names the following activities and nothing else; `next` names them in
// `to:` and leaves `condition` absent. Nothing the old key could express is dropped.
//
// IDEMPOTENT BY CONSTRUCTION. A model already on `next:` has no `next_activities:` to match, so a
// second run plans nothing.
//
// TEXT, NOT YAML. Inherited from the modules before it and load-bearing for the same reason: this
// tool has no runtime dependencies and edits text, so comments, key order, quoting and line endings
// survive. Every migrated target is the author's own token, re-placed.
//
// WHAT IT REFUSES. An activity that would end up declaring `next` twice - because it already had
// one beside its `next_activities` - is left alone and reported. The schema says an activity
// declares one or the other and never both, so writing the second key would produce a document the
// validator rejects, which is worse than a migration that stops and says so.

const YAML_FILE = /\.(yaml|yml)$/i;
const PROSE_FILE = /\.(md|markdown)$/i;
const FLOW_LIST = /^(\s*)next_activities:\s*\[([^\]]*)\]\s*$/;
const BLOCK_KEY = /^(\s*)next_activities:\s*$/;
const LIST_ITEM = /^(\s*)-\s+(.+?)\s*$/;
const NEXT_KEY = /^(\s*)next:/;

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
  return /^\s*/.exec(text)![0].length;
}

/** The targets of a flow list, in the author's own spelling, with quotes left as written. */
function flowTargets(inner: string): string[] {
  return inner.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/**
 * Every `next_activities` rewritten as `next`. A single successor keeps its line; a fork becomes a
 * block list, one `to:` per branch, ready for the condition the author has not written yet.
 */
function rewriteSuccessors(lines: SourceLine[]): { lines: SourceLine[]; single: number; forks: number; empty: number } {
  const out: SourceLine[] = [];
  let single = 0;
  let forks = 0;
  let empty = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    const flow = line.text.match(FLOW_LIST);
    if (flow) {
      const indent = flow[1]!;
      const targets = flowTargets(flow[2]!);
      if (targets.length === 0) {
        // An empty list is the author's own statement and it migrates like any other. Skipping it
        // would leave the superseded key in the model, still warning, after a run that reported
        // success - and an empty `next` reads exactly as the empty `next_activities` did, because
        // every consumer treats an empty successor list and an absent one alike.
        out.push({ text: `${indent}next: []`, eol: line.eol });
        empty += 1;
        continue;
      }
      if (targets.length === 1) {
        out.push({ text: `${indent}next: [{to: ${targets[0]}}]`, eol: line.eol });
        single += 1;
      } else {
        out.push({ text: `${indent}next:`, eol: line.eol });
        for (const target of targets) out.push({ text: `${indent}  - to: ${target}`, eol: line.eol });
        forks += 1;
      }
      continue;
    }

    const block = line.text.match(BLOCK_KEY);
    if (block) {
      const keyIndent = block[1]!.length;
      let end = index + 1;
      const items: string[] = [];
      while (end < lines.length) {
        const candidate = lines[end]!;
        if (candidate.text.trim() === '') break;
        if (indentOf(candidate.text) <= keyIndent) break;
        const item = candidate.text.match(LIST_ITEM);
        if (!item) break;
        items.push(item[2]!);
        end += 1;
      }
      if (items.length === 0) { out.push({ text: `${block[1]}next: []`, eol: line.eol }); empty += 1; continue; }
      out.push({ text: `${block[1]}next:`, eol: line.eol });
      for (let position = 0; position < items.length; position += 1) {
        const source = lines[index + 1 + position]!;
        const item = source.text.match(LIST_ITEM)!;
        out.push({ text: `${item[1]}- to: ${items[position]}`, eol: source.eol });
      }
      if (items.length === 1) single += 1; else forks += 1;
      index = end - 1;
      continue;
    }

    out.push(line);
  }

  return { lines: out, single, forks, empty };
}

/**
 * Mappings that would carry `next:` twice after the rewrite. Two keys are siblings when they share
 * an indent with no shallower line between them, which is what "the same mapping" means in a text
 * pass that never parses the document.
 */
function duplicateNextKeys(lines: SourceLine[]): number {
  let duplicates = 0;
  const seenAtIndent = new Set<number>();
  for (const line of lines) {
    if (line.text.trim() === '') continue;
    const indent = indentOf(line.text);
    // Anything deeper than this line belongs to a mapping that has just ended - including the
    // sibling list item case, where a `- ` at the parent indent starts the next activity.
    for (const known of [...seenAtIndent]) if (known > indent) seenAtIndent.delete(known);
    if (!NEXT_KEY.test(line.text)) continue;
    if (seenAtIndent.has(indent)) duplicates += 1;
    else seenAtIndent.add(indent);
  }
  return duplicates;
}

interface FileAnalysis {
  absolutePath: string;
  relativePath: string;
  rewritten: string;
  single: number;
  forks: number;
  empty: number;
}

function modelFiles(root: string): { yaml: string[]; prose: string[] } {
  const yaml: string[] = [];
  const prose: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (YAML_FILE.test(entry.name)) yaml.push(full);
      else if (PROSE_FILE.test(entry.name)) prose.push(full);
    }
  };
  walk(root);
  return { yaml: yaml.sort(), prose: prose.sort() };
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
    const stale = text.match(/\bnext_activities\b/g);
    if (!stale) continue;
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    warnings.push(`${relativePath}: ${stale.length} mention(s) of \`next_activities\` in prose - rewrite by hand`);
  }

  for (const absolutePath of yaml) {
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    const original = fs.readFileSync(absolutePath, 'utf8');
    if (!original.includes('next_activities')) continue;

    const rewritten = rewriteSuccessors(readLines(absolutePath));
    const duplicates = duplicateNextKeys(rewritten.lines);
    if (duplicates > 0) {
      warnings.push(`${relativePath}: ${duplicates} activity/ies would declare \`next\` twice - it already has one beside \`next_activities\`. Merge them by hand; the file is left alone`);
      continue;
    }

    const text = joinLines(rewritten.lines);
    if (text === original) continue;

    files.push({ absolutePath, relativePath, rewritten: text, single: rewritten.single, forks: rewritten.forks, empty: rewritten.empty });
    const parts: string[] = [];
    if (rewritten.single > 0) parts.push(`${rewritten.single} single successor(s) inline`);
    if (rewritten.forks > 0) parts.push(`${rewritten.forks} fork(s) expanded, one \`to:\` per branch`);
    if (rewritten.empty > 0) parts.push(`${rewritten.empty} empty list(s) carried over`);
    changes.push({ type: 'edit-yaml', path: relativePath, detail: parts.join(', ') });
  }

  return { files, changes, warnings };
}

function buildPlan(blueprintDir: string): UpdatePlan {
  const analysis = analyse(blueprintDir);
  return { sourceVersion: '2.8', targetVersion: '2.8', description: update.description, changes: analysis.changes, warnings: analysis.warnings };
}

function applyPlan(blueprintDir: string): UpdateResult {
  const analysis = analyse(blueprintDir);
  const plan: UpdatePlan = { sourceVersion: '2.8', targetVersion: '2.8', description: update.description, changes: analysis.changes, warnings: analysis.warnings };
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
    '`next_activities` becomes `next` (v2.8.23): each successor moves to a `to:` entry that can carry the condition taking that branch, with a fork expanded to block style and a lone successor left on its line',
  plan: buildPlan,
  apply: applyPlan,
};
