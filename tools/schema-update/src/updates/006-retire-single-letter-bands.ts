import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// Six one-letter id bands get an unambiguous spelling (v2.8.11). A one-letter band is a
// prefix-collision hazard against every longer band starting with the same letter, and the schema
// had begun carrying sentences to say which of two it meant. This rewrites a model onto the new
// spelling; the schema accepts both, so a model that has not run this still validates.
//
//   D001   -> DC001    Decision        T001  -> TRO001  TradeOff
//   R001   -> RSK001   Risk            A001  -> ASM001  Assumption
//   G001   -> GL001    Goal            AS001 -> ASC001  Association
//
// THE NEGATIVE HALF IS THE WHOLE GAME. A rename tool that is too greedy is worse than none: it
// turns `DSC001` into `DCSC001` and nobody notices until a reference stops resolving. Every rewrite
// is anchored on both sides - the band must be preceded by a non-word character and followed by
// exactly three digits and then a non-word character - so `DSC001`, `DR001`, `DEC001`, `RT001`,
// `RES001`, `RL001`, `TC001`, `TR001` and `ACT001` cannot match, and neither can `D0011`.
//
// `AS001` AND `A001` ARE DIFFERENT ENTITIES and both move, to different bands. They cannot collide:
// `AS001` does not match the `A` rule (the character after `A` is `S`, not a digit) and `A001` does
// not match the `AS` rule. The pairs are still applied longest-first, because a reader checking the
// order by eye should not have to derive that.
//
// PREFIXED FORMS. An id appears bare (`D001`) and context-qualified (`orders.D001`). A `.` is a
// non-word character, so the left anchor admits both and the prefix survives untouched. A tool
// tested only on the bare form passes and then leaves every namespaced reference dangling.
//
// IDEMPOTENT BY CONSTRUCTION. A model already on the new spelling contains no retired band, so a
// second run plans nothing - which is what makes it safe inside a chain that may be re-run.
//
// TEXT, NOT YAML. Inherited from the modules before it: this tool has no runtime dependencies and
// its modules edit text so comments, key order, quoting and line endings survive.
//
// ONE TABLE, TWO FILES, AND A TEST THAT JOINS THEM. The canonical mapping is the schema's own
// `x-retired-bands` block, which the validator reads to report a model still using an old band;
// this package compiles with `rootDir: src` and cannot reach it at build time, so the pairs are
// restated here and the accompanying test asserts the two lists are identical. The duplication is
// mechanical rather than trusted: they cannot disagree without a red test.

/** Retired band -> its replacement. Must equal `x-retired-bands` in the v2.8 metamodel. */
export const BAND_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['AS', 'ASC'],
  ['D', 'DC'],
  ['R', 'RSK'],
  ['G', 'GL'],
  ['T', 'TRO'],
  ['A', 'ASM'],
];

const YAML_FILE = /\.(yaml|yml)$/i;

/**
 * One band's rewrite, anchored on both sides.
 *
 * `\b` alone would be wrong on the right: `D0011` has a word boundary nowhere useful, and
 * `(?!\d)` is what actually says "exactly three digits". On the left `\b` is enough, because the
 * character before a band is either nothing, a `.`, a quote or whitespace - all non-word.
 */
function rewriteBand(text: string, from: string, to: string): { text: string; count: number } {
  let count = 0;
  const pattern = new RegExp(`\\b${from}(\\d{3})(?!\\d)`, 'g');
  const rewritten = text.replace(pattern, (_match, digits: string) => {
    count += 1;
    return `${to}${digits}`;
  });
  return { text: rewritten, count };
}

/** Every retired band rewritten in one file's text, with the per-band counts. */
export function rebandText(text: string): { text: string; counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {};
  let current = text;
  let total = 0;
  for (const [from, to] of BAND_RENAMES) {
    const result = rewriteBand(current, from, to);
    current = result.text;
    if (result.count > 0) {
      counts[from] = result.count;
      total += result.count;
    }
  }
  return { text: current, counts, total };
}

interface FileAnalysis {
  absolutePath: string;
  relativePath: string;
  rewritten: string;
  counts: Record<string, number>;
  total: number;
}

function yamlFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (YAML_FILE.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

function analyse(blueprintDir: string): { files: FileAnalysis[]; changes: PlannedChange[]; warnings: string[] } {
  const files: FileAnalysis[] = [];
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];

  for (const absolutePath of yamlFiles(blueprintDir)) {
    const original = fs.readFileSync(absolutePath, 'utf8');
    const { text: rewritten, counts, total } = rebandText(original);
    if (total === 0) continue;
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    files.push({ absolutePath, relativePath, rewritten, counts, total });
    const detail = BAND_RENAMES.filter(([from]) => counts[from])
      .map(([from, to]) => `${counts[from]} ${from}### -> ${to}###`)
      .join(', ');
    changes.push({ type: 'edit-yaml', path: relativePath, detail });
  }

  // A model's own prose is not rewritten - a sentence is not a reference this tool can retarget
  // without reading it - but a README naming a band the migration retires is stale the moment it
  // lands, and silently so.
  const prose: string[] = [];
  const walkProse = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkProse(full);
      else if (/\.(md|markdown)$/i.test(entry.name)) prose.push(full);
    }
  };
  walkProse(blueprintDir);
  for (const absolutePath of prose) {
    const { total } = rebandText(fs.readFileSync(absolutePath, 'utf8'));
    if (total === 0) continue;
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    warnings.push(`${relativePath}: ${total} id(s) in prose still name a retired band - rewrite by hand`);
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
    'Retire the one-letter id bands (v2.8.11): D### to DC###, R### to RSK###, G### to GL###, T### to TRO###, A### to ASM###, AS### to ASC###, whole-word and context-prefix aware',
  plan: buildPlan,
  apply: applyPlan,
};
