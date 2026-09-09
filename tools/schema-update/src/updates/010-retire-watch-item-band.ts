import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// The seventh one-letter id band gets an unambiguous spelling (v2.8.12): a watch item's `W001`
// becomes `WCH001`. `W` is a prefix of `WI` (work item) and of longer bands in the realm and
// brandvoice suites, which is the hazard the six bands before it were retired for. The schema
// accepts both spellings, so a model that has not run this still validates.
//
// STRUCTURAL, NOT TEXTUAL - and this is the one place this package departs from its siblings.
// `006` rewrites every occurrence of a band in a file's text, which is right for `D###` and
// `RSK###`: those are referenced from other layers, so a reference left behind would dangle. A
// watch item is referenced by nothing, and `W` followed by three digits is a shape that occurs in
// prose - a part number, a room, a form. Rewriting text would silently edit an author's sentence.
// So this module rewrites the `id:` of a `watchlist[]` entry and nothing else, and REPORTS any
// other `W###` it passes rather than touching it.
//
// The block scan is the idiom `007` uses for the same reason: no YAML parse, so comments, key
// order, quoting and line endings survive.
//
// IDEMPOTENT BY CONSTRUCTION. A watchlist already on `WCH###` matches nothing, so a second run
// plans nothing - which is what makes it safe inside a chain that may be re-run.

/** Retired band -> its replacement. Must be part of `x-retired-bands` in the v2.8 metamodel. */
export const BAND_RENAMES: ReadonlyArray<readonly [string, string]> = [['W', 'WCH']];

const YAML_FILE = /\.(yaml|yml)$/i;
/** The key whose entries own the ids this module rewrites. */
const WATCHLIST_KEY = /^(\s*)watchlist:\s*$/;
/**
 * An `id:` line inside that block, bare or context-qualified, quoted or not.
 * The right anchor is `(?!\d)` rather than `\b`, so `W0011` is not a three-digit id.
 */
const WATCH_ID = /^(\s*(?:-\s+)?id:\s*)(["']?)((?:[a-z][a-z0-9-]*\.)?)W(\d{3})(?!\d)(\2)(\s*)$/;
/** Any other three-digit `W` id in the file, which is reported and never rewritten. */
const LOOSE_W = /\bW(\d{3})(?!\d)/g;

/** The indent of a line, counting spaces only - this tree has no tabs in YAML. */
function indentOf(line: string): number {
  return line.length - line.replace(/^ */, '').length;
}

/**
 * Rewrite every watch-item id in one file's text.
 *
 * Returns the rewritten text, how many ids moved, and how many `W###` occurrences were left alone
 * because they sit outside a `watchlist:` block or are not an `id:`.
 */
export function rebandWatchlist(text: string): { text: string; ids: number; untouched: number } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let ids = 0;
  let blockIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const opens = line.match(WATCHLIST_KEY);
    if (opens) {
      blockIndent = opens[1]!.length;
      continue;
    }
    if (blockIndent === null) continue;
    // A blank line does not end a block; a line at or left of the key's own indent does.
    if (line.trim() === '') continue;
    if (indentOf(line) <= blockIndent) {
      blockIndent = null;
      // The line that closed the block may itself open another one.
      const reopens = line.match(WATCHLIST_KEY);
      if (reopens) blockIndent = reopens[1]!.length;
      continue;
    }
    const match = line.match(WATCH_ID);
    if (!match) continue;
    lines[index] = `${match[1]}${match[2]}${match[3]}WCH${match[4]}${match[5]}${match[6]}`;
    ids += 1;
  }

  const rewritten = lines.join(newline);
  const remaining = [...rewritten.matchAll(LOOSE_W)].length;
  return { text: rewritten, ids, untouched: remaining };
}

function walkYaml(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkYaml(full, out);
    else if (YAML_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

function analyse(modelDir: string): { changes: PlannedChange[]; warnings: string[] } {
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];
  for (const file of walkYaml(modelDir).sort()) {
    const { text, ids, untouched } = rebandWatchlist(fs.readFileSync(file, 'utf8'));
    const relative = path.relative(modelDir, file);
    if (ids > 0) {
      changes.push({ type: 'edit-yaml', path: relative, detail: `${ids} watch-item id(s) W### -> WCH###` });
    }
    if (untouched > 0) {
      warnings.push(
        `${relative}: ${untouched} W### occurrence(s) left alone - not a watchlist entry's id. ` +
          `Check by hand whether any of them names a watch item.`,
      );
    }
  }
  return { changes, warnings };
}

function buildPlan(modelDir: string): UpdatePlan {
  const analysis = analyse(modelDir);
  return {
    sourceVersion: '2.8',
    targetVersion: '2.8',
    description: update.description,
    changes: analysis.changes,
    warnings: analysis.warnings,
  };
}

function applyPlan(modelDir: string): UpdateResult {
  const analysis = analyse(modelDir);
  const plan: UpdatePlan = {
    sourceVersion: '2.8',
    targetVersion: '2.8',
    description: update.description,
    changes: analysis.changes,
    warnings: analysis.warnings,
  };
  const errors: string[] = [];
  try {
    // Recomputed rather than carried on the plan: `PlannedChange` describes a change, it does not
    // hold the file. Same shape as the modules before it, so a plan is always cheap to print.
    for (const file of walkYaml(modelDir).sort()) {
      const before = fs.readFileSync(file, 'utf8');
      const { text, ids } = rebandWatchlist(before);
      if (ids > 0) fs.writeFileSync(file, text, 'utf8');
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
    'Retire the watch-item band (v2.8.12): W### to WCH###, rewriting the id of a watchlist entry and reporting every other W### rather than touching it',
  plan: buildPlan,
  apply: applyPlan,
};
