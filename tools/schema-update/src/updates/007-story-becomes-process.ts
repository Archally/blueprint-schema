import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';
import { modelFiles } from '../model-files.js';

// The entity the schema has always described as a process is called one (v2.8.10). `story` and
// `user_story` sat in one file for two different things - what the modelled system does, and what
// someone intends to deliver - and read as synonyms. The odd one out is renamed:
//
//   # orders/story.yaml                       # orders/story.yaml (the file keeps its name)
//   stories:                                  processes:
//     - id: orders.STR001                       - id: orders.PRC001
//       process:                        =>        trigger:
//         id: orders.SP001                          type: message
//         trigger:                                end_states:
//           type: message                           - name: "Placed"
//         end_states:                             activities:
//           - name: "Placed"                        - id: orders.PA001
//       activities:
//         - id: orders.SA001
//
// FOUR EDITS, AND THE ORDER MATTERS. The `process:` sub-object is flattened FIRST, because after
// the rename it would read `process.process` and the block would be indistinguishable from the
// entity that holds it. Its `id:` is dropped rather than promoted - `SP###` typed the nested thing,
// and there is no longer a nested thing to give an id to. Then the bands: `STR###` to `PRC###`,
// `SA###` to `PA###`. Then the keys that name the entity: `stories:` to `processes:`, `story_refs:`
// to `process_refs:`, `storyUri:` to `processUri:`.
//
// THE FILE KEEPS ITS NAME. A narrative file declares `user_story` and `use_case` beside the entity
// this renames - on the corpus measured here, 12 of 16 carry all three and one holds 2 processes
// against 11 of the other two - so naming it after the renamed entity would name it after the
// smallest thing in it. Both spellings load on every line from 2.6, so the content moves and the
// filename does not.
//
// `user_stories:`, `linked_user_stories:` and `US###` are a different entity and never move. The
// key rewrite anchors on the start of the key so `user_stories:` cannot match, and the band
// rewrites are word-anchored so `US001` cannot.
//
// IDEMPOTENT BY CONSTRUCTION. A model already on the new spelling has no `STR###`, no `SA###` and
// no `process:` block to flatten, so a second run plans nothing. That is what makes it safe inside
// a chain that may be re-run.
//
// TEXT, NOT YAML. Inherited from the modules before it and load-bearing for the same reason: this
// tool has no runtime dependencies and its modules edit text so comments, key order, quoting and
// line endings survive. Every promoted line is the author's own line, re-indented.
//
// WHAT IT REFUSES. A `process:` written in flow style (`process: { id: SP001, ... }`) is left alone
// and reported: flattening it would mean parsing and re-emitting a construct this tool deliberately
// does not parse, and leaving it renamed but unflattened would produce the `process.process` the
// flatten exists to prevent.

const OLD_BAND = /\b(STR|SA)\d{3}\b/;
const BLOCK_KEY = /^(\s*)process:\s*$/;
const FLOW_BLOCK = /^(\s*)process:\s*[[{]/;
const NESTED_ID = /^\s*id:\s*(["']?)([a-z][a-z0-9-]*\.)?SP\d{3}\1\s*$/i;

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

/**
 * Every `process:` block flattened into the mapping that holds it, and the count of `SP###` ids
 * dropped with them. A block is located by structure - a bare `process:` key and every deeper line
 * under it - so a model that indents differently is still read correctly.
 */
function flattenProcessBlocks(lines: SourceLine[]): { lines: SourceLine[]; blocks: number; ids: number; refused: number } {
  const out: SourceLine[] = [];
  let blocks = 0;
  let ids = 0;
  let refused = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (FLOW_BLOCK.test(line.text)) { refused += 1; out.push(line); continue; }
    const match = line.text.match(BLOCK_KEY);
    if (!match) { out.push(line); continue; }
    const blockIndent = match[1]!.length;
    let end = index + 1;
    while (end < lines.length && (lines[end]!.text.trim() === '' || indentOf(lines[end]!.text) > blockIndent)) end += 1;
    const body = lines.slice(index + 1, end);
    const childIndent = body.find((child) => child.text.trim() !== '');
    if (!childIndent) { out.push(line); continue; }
    const dedent = indentOf(childIndent.text) - blockIndent;
    for (const child of body) {
      if (NESTED_ID.test(child.text) && indentOf(child.text) === indentOf(childIndent.text)) { ids += 1; continue; }
      out.push({ text: child.text.slice(0, dedent).trim() === '' ? child.text.slice(dedent) : child.text, eol: child.eol });
    }
    blocks += 1;
    index = end - 1;
  }
  return { lines: out, blocks, ids, refused };
}

/** The band and key rewrites, applied to one already-flattened file. */
function rewriteText(text: string): { text: string; bands: number; keys: number } {
  let bands = 0;
  let keys = 0;
  const renamed = text
    .replace(/\bSTR(\d{3})\b/g, (_, digits) => { bands += 1; return `PRC${digits}`; })
    .replace(/\bSA(\d{3})\b/g, (_, digits) => { bands += 1; return `PA${digits}`; })
    .replace(/^(\s*)(- )?stories:/gm, (_, indent, dash) => { keys += 1; return `${indent}${dash ?? ''}processes:`; })
    .replace(/^(\s*)(- )?story_refs:/gm, (_, indent, dash) => { keys += 1; return `${indent}${dash ?? ''}process_refs:`; })
    .replace(/^(\s*)(- )?storyUri:/gm, (_, indent, dash) => { keys += 1; return `${indent}${dash ?? ''}processUri:`; })
    // A change program classifies each entity it touches with `entity_type:`, drawn from the same
    // vocabulary the rename moves. The key keeps its name and the VALUE moves with the entity, so
    // the rewrite is scoped to this field: the words appear elsewhere as prose and as relation
    // names (`next_activity`, `screen_story`), which this rename leaves alone.
    .replace(
      /^(\s*)(- )?entity_type:([ \t]*)(story|activity)([ \t]*)(#.*)?$/gm,
      (_, indent, dash, gap, value, trail, comment) => {
        keys += 1;
        const moved = value === 'story' ? 'process' : 'process-activity';
        return `${indent}${dash ?? ''}entity_type:${gap}${moved}${comment ? `${trail}${comment}` : ''}`;
      },
    );
  return { text: renamed, bands, keys };
}

interface FileAnalysis {
  absolutePath: string;
  relativePath: string;
  rewritten: string;
  blocks: number;
  ids: number;
  bands: number;
  keys: number;
  refused: number;
}

function analyse(blueprintDir: string): { files: FileAnalysis[]; changes: PlannedChange[]; warnings: string[] } {
  const files: FileAnalysis[] = [];
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];

  const { yaml, prose } = modelFiles(blueprintDir);

  // A model's own prose is not rewritten - a README's sentence is not a reference this tool can
  // retarget without reading it - but a README naming an id that no longer exists is stale the
  // moment the migration lands, and silently so. Named, never touched.
  for (const absolutePath of prose) {
    const text = fs.readFileSync(absolutePath, 'utf8');
    const stale = text.match(/\b(STR|SA|SP)\d{3}\b/g);
    if (!stale) continue;
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    warnings.push(`${relativePath}: ${stale.length} id(s) in prose still name the old bands (${[...new Set(stale)].slice(0, 4).join(', ')}) - rewrite by hand`);
  }

  for (const absolutePath of yaml) {
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    const original = fs.readFileSync(absolutePath, 'utf8');
    const flattened = flattenProcessBlocks(readLines(absolutePath));
    const { text: rewritten, bands, keys } = rewriteText(joinLines(flattened.lines));
    if (flattened.refused > 0) {
      warnings.push(`${relativePath}: ${flattened.refused} flow-style \`process:\` left alone - flatten it by hand, or the rename produces \`process.process\``);
    }
    if (rewritten === original) continue;

    files.push({ absolutePath, relativePath, rewritten, blocks: flattened.blocks, ids: flattened.ids, bands, keys, refused: flattened.refused });
    if (rewritten !== original) {
      const parts: string[] = [];
      if (flattened.blocks > 0) parts.push(`${flattened.blocks} \`process:\` block(s) flattened`);
      if (flattened.ids > 0) parts.push(`${flattened.ids} \`SP###\` id(s) dropped`);
      if (bands > 0) parts.push(`${bands} id(s) rebanded`);
      if (keys > 0) parts.push(`${keys} key(s) renamed`);
      changes.push({ type: 'edit-yaml', path: relativePath, detail: parts.join(', ') });
    }
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
    for (const file of analysis.files) {
      fs.writeFileSync(file.absolutePath, file.rewritten, 'utf8');
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
    '`story` becomes `process` (v2.8.10): `STR###` to `PRC###`, `SA###` to `PA###`, `stories:` to `processes:`, and the `process` sub-object flattened into the entity so `SP###` retires',
  plan: buildPlan,
  apply: applyPlan,
};
