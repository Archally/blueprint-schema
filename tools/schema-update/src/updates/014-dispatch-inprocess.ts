import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// An operation says how it is invoked, and since v2.8.27 the transport-free value is spelled the
// way the contract kind that carries it is spelled.
//
//   dispatch: in-process        =>   dispatch: inprocess
//
// ONE VALUE, AND THE OLD SPELLING STILL VALIDATES. Both are accepted, so this migration is a
// convergence rather than a repair: a model left alone keeps working, and one that runs this reads
// the same as the `contracts.inprocess` block beside it.
//
// KEY POSITION, NOT TEXT SEARCH. The value is rewritten only where `dispatch:` opens a mapping
// entry on its own line. This matters more than it looks: a model's prose - a summary, a
// description, a decision rationale - says `dispatch: in-process` in sentences, and those are string
// values the author wrote, not declarations this tool may edit. Measured 2026-09-13 over the models
// this was developed against: an unanchored search returns 162 hits, key position returns 139, and
// the 23 between them are all prose.
//
// A FLOW MAPPING IS REPORTED, NOT REWRITTEN. `{dispatch: in-process}` on one line with other keys
// cannot be edited without re-forming the author's line, so it is named and left.
//
// IDEMPOTENT BY CONSTRUCTION. A model already on the new spelling has no `in-process` in key
// position, so a second run plans nothing.
//
// TEXT, NOT YAML. Inherited from the modules before it, and load-bearing here in particular: some
// models are written CRLF throughout, and a pass that reserialized the document would rewrite every
// line of them to report a one-word change.

const YAML_FILE = /\.(yaml|yml)$/i;
const PROSE_FILE = /\.(md|markdown)$/i;
const DISPATCH_VALUE = /^(\s*dispatch:\s*)(['"]?)in-process\2(\s*(?:#.*)?)$/;
const DISPATCH_IN_FLOW = /[{,]\s*dispatch:\s*(['"]?)in-process\1\s*[,}]/;

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

interface FileAnalysis {
  absolutePath: string;
  relativePath: string;
  rewritten: string;
  sites: number;
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
  // retarget - but one naming the superseded spelling is stale the moment the migration lands.
  for (const absolutePath of prose) {
    const text = fs.readFileSync(absolutePath, 'utf8');
    const stale = text.match(/dispatch:?\s*in-process/g);
    if (!stale) continue;
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    warnings.push(`${relativePath}: ${stale.length} mention(s) of \`dispatch: in-process\` in prose - rewrite by hand`);
  }

  for (const absolutePath of yaml) {
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    const original = fs.readFileSync(absolutePath, 'utf8');
    if (!original.includes('in-process')) continue;

    const lines = readLines(absolutePath);
    let sites = 0;
    const out = lines.map((line) => {
      if (DISPATCH_IN_FLOW.test(line.text)) {
        warnings.push(`${relativePath}: \`dispatch: in-process\` inside a flow mapping - rewrite by hand; the line is left alone`);
        return line;
      }
      const match = line.text.match(DISPATCH_VALUE);
      if (!match) return line;
      sites += 1;
      return { text: `${match[1]}${match[2]}inprocess${match[2]}${match[3]}`, eol: line.eol };
    });
    if (sites === 0) continue;

    const text = joinLines(out);
    if (text === original) continue;

    files.push({ absolutePath, relativePath, rewritten: text, sites });
    changes.push({ type: 'edit-yaml', path: relativePath, detail: `${sites} operation(s) on \`dispatch: inprocess\`` });
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
    "`dispatch: in-process` becomes `dispatch: inprocess` (v2.8.27): the transport-free invocation value converges on the spelling of the contract kind that carries it, rewritten only where `dispatch:` opens a mapping entry",
  plan: buildPlan,
  apply: applyPlan,
};
