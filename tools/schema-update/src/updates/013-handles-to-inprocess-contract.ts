import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';
import { modelFiles } from '../model-files.js';

// A service says which operations it owns, and since v2.8.27 it says so under the coupling that
// carries them.
//
//   handles: [orders.CMD001]        =>   contracts:
//                                          inprocess:
//                                            provide: [orders.CMD001]
//
// A RELOCATION, NOT A RENAME. The refs move out of the service mapping and into a nested block two
// levels down, and the block may not exist yet. Measured across the corpus 2026-09-13: 38 services
// carry `handles:`, 20 of them already declare `contracts:` and 18 do not. So there are two target
// shapes - insert into an existing container, or mint one in the place the old key occupied - and
// the module picks by looking, never by assuming.
//
// THE AUTHOR'S OWN FORM SURVIVES. A flow list stays a flow list; a block list stays a block list.
// Nesting already costs three lines, so normalising the fourth would be a rewrite the author did
// not ask for. Measured: 16 flow, 22 block.
//
// A BLOCK MOVES AS A REGION, NOT AS ITEMS. One corpus list opens with a comment above its first
// entry, and a pass that re-emitted items from their parsed tokens would drop it. Everything under
// the key - entries, comments, blank lines - is shifted by one constant, so relative structure is
// exactly what it was.
//
// LOSSLESS. `handles` named the operations a service owns and nothing else; `provide` names them
// and also says which coupling carries them. Nothing the old key could express is dropped, and the
// graph binding is identical - both materialize `handled_by`.
//
// IDEMPOTENT BY CONSTRUCTION. A model already on the new spelling has no `handles:` to match, so a
// second run plans nothing.
//
// TEXT, NOT YAML. Inherited from the modules before it and load-bearing for the same reason: this
// tool has no runtime dependencies and edits text, so comments, key order, quoting and line endings
// survive. Every migrated ref is the author's own token, re-placed.
//
// WHAT IT REFUSES. A service whose `contracts:` block already declares `inprocess:` is left alone
// and reported - merging two `provide:` lists is a judgement about which operations belong to which
// coupling, and this module has no way to make it. So is a `contracts:` written in flow form, which
// cannot be spliced into without rewriting the author's line.
//
// WHAT IT ONLY REPORTS. `provides:`, the sibling key removed from the schema in the same version.
// It has no replacement, so there is nothing to relocate it to; a model carrying one is rejected
// outright rather than deprecated, and the module names the line and leaves it.

const HANDLES_KEY = /^(\s*)handles:(.*)$/;
const PROVIDES_KEY = /^\s*provides:/;
const CONTRACTS_KEY = /^(\s*)contracts:(.*)$/;
const INPROCESS_KEY = /^\s*inprocess:/;
const LIST_ITEM_OPENER = /^(\s*)-\s+\S/;

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

function isBlank(text: string): boolean {
  return text.trim() === '';
}

function isComment(text: string): boolean {
  return text.trim().startsWith('#');
}

/**
 * The last line belonging to the key at `keyIndex`, exclusive.
 *
 * Everything indented deeper than the key is the key's own, blank lines and comments included. The
 * region ends at the first non-blank line that is no deeper - the next sibling key, the next list
 * item, or the end of the enclosing mapping.
 */
function regionEnd(lines: SourceLine[], keyIndex: number, keyIndent: number): number {
  let end = keyIndex + 1;
  let lastContent = keyIndex + 1;
  while (end < lines.length) {
    const { text } = lines[end]!;
    if (isBlank(text)) { end += 1; continue; }
    if (indentOf(text) <= keyIndent) break;
    end += 1;
    lastContent = end;
  }
  // Trailing blank lines belong to whatever comes next, not to the key.
  return lastContent;
}

/**
 * The `contracts:` key in the same mapping as the key at `keyIndex`, or null.
 *
 * Two keys are siblings when they share an indent with nothing shallower between them - the same
 * definition `012` uses, which is what "the same mapping" can mean to a pass that never parses the
 * document. A `- ` opener two columns shallower is the mapping's own first line and ends the search
 * rather than crossing into a neighbour.
 */
function siblingKey(lines: SourceLine[], keyIndex: number, keyIndent: number, pattern: RegExp): number | null {
  const scan = (from: number, step: number): number | null => {
    for (let index = from; index >= 0 && index < lines.length; index += step) {
      const { text } = lines[index]!;
      if (isBlank(text) || isComment(text)) continue;
      const indent = indentOf(text);
      if (indent > keyIndent) continue;
      if (indent < keyIndent) return null;
      if (pattern.test(text)) return index;
      if (LIST_ITEM_OPENER.test(text)) return null;
    }
    return null;
  };
  return scan(keyIndex - 1, -1) ?? scan(keyIndex + 1, +1);
}

/** A key directly inside `contracts:`, or null. Used to find an `inprocess:` already in place. */
function childKey(lines: SourceLine[], parentIndex: number, parentIndent: number, step: number, pattern: RegExp): number | null {
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text) || isComment(text)) continue;
    const indent = indentOf(text);
    if (indent <= parentIndent) return null;
    if (indent === parentIndent + step && pattern.test(text)) return index;
  }
  return null;
}

/** The indent step this mapping uses, read from `contracts:`'s own first child. */
function childStep(lines: SourceLine[], parentIndex: number, parentIndent: number): number {
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text) || isComment(text)) continue;
    const indent = indentOf(text);
    if (indent <= parentIndent) return 2;
    return indent - parentIndent;
  }
  return 2;
}

interface Relocation {
  keyIndex: number;
  /** Exclusive. */
  endIndex: number;
  /** Where the block is spliced in: the `contracts:` line, or the `handles:` line when minting one. */
  anchorIndex: number;
  lines: SourceLine[];
  refs: number;
  minted: boolean;
}

/** The refs a `handles:` region names, for the count the plan is reconciled against. */
function countRefs(lines: SourceLine[], keyIndex: number, endIndex: number, inlineBody: string): number {
  if (inlineBody !== '') {
    const inner = inlineBody.replace(/^\[/, '').replace(/\]$/, '');
    return inner.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '').length;
  }
  let refs = 0;
  for (let index = keyIndex + 1; index < endIndex; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text) || isComment(text)) continue;
    if (/^\s*-\s+\S/.test(text)) refs += 1;
  }
  return refs;
}

/**
 * The region's own lines, shifted so its shallowest line lands on `targetIndent`.
 *
 * One constant for every line, so a comment above an entry stays above it and a nested value stays
 * nested. The alternative - re-emitting entries from their tokens - loses everything that is not an
 * entry, and the corpus has such a list.
 */
function shiftRegion(lines: SourceLine[], from: number, to: number, targetIndent: number): SourceLine[] {
  let minIndent = Number.POSITIVE_INFINITY;
  for (let index = from; index < to; index += 1) {
    const { text } = lines[index]!;
    if (isBlank(text)) continue;
    minIndent = Math.min(minIndent, indentOf(text));
  }
  if (!Number.isFinite(minIndent)) return [];
  const shift = targetIndent - minIndent;
  return lines.slice(from, to).map((line) => {
    if (isBlank(line.text)) return { text: '', eol: line.eol };
    const indent = indentOf(line.text);
    return { text: ' '.repeat(Math.max(0, indent + shift)) + line.text.slice(indent), eol: line.eol };
  });
}

interface FileAnalysis {
  absolutePath: string;
  relativePath: string;
  rewritten: string;
  services: number;
  refs: number;
  minted: number;
}

/** Every `handles:` in one file planned as a relocation, plus what the module declines to touch. */
function planFile(lines: SourceLine[], relativePath: string): { relocations: Relocation[]; warnings: string[] } {
  const relocations: Relocation[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.text.match(HANDLES_KEY);
    if (!match) continue;

    const indent = match[1]!.length;
    const inlineBody = match[2]!.trim();
    const endIndex = inlineBody === '' ? regionEnd(lines, index, indent) : index + 1;
    const refs = countRefs(lines, index, endIndex, inlineBody);
    const eol = lines[index]!.eol || '\n';

    const contractsIndex = siblingKey(lines, index, indent, CONTRACTS_KEY);

    if (contractsIndex !== null) {
      const contractsLine = lines[contractsIndex]!;
      const rest = contractsLine.text.match(CONTRACTS_KEY)![2]!.trim();
      if (rest !== '') {
        warnings.push(`${relativePath}:${contractsIndex + 1}: \`contracts:\` is written in flow form - splice \`inprocess.provide\` in by hand; the service is left alone`);
        index = endIndex - 1;
        continue;
      }
      const contractsIndent = indentOf(contractsLine.text);
      const step = childStep(lines, contractsIndex, contractsIndent);
      const existing = childKey(lines, contractsIndex, contractsIndent, step, INPROCESS_KEY);
      if (existing !== null) {
        warnings.push(`${relativePath}:${index + 1}: the service already declares \`contracts.inprocess\` - merge its \`provide:\` with \`handles:\` by hand; the service is left alone`);
        index = endIndex - 1;
        continue;
      }

      const inserted: SourceLine[] = [
        { text: `${' '.repeat(contractsIndent + step)}inprocess:`, eol },
        inlineBody === ''
          ? { text: `${' '.repeat(contractsIndent + step * 2)}provide:`, eol }
          : { text: `${' '.repeat(contractsIndent + step * 2)}provide: ${inlineBody}`, eol },
      ];
      if (inlineBody === '') {
        const body = shiftRegion(lines, index + 1, endIndex, contractsIndent + step * 3);
        if (body.length === 0) inserted[1] = { text: `${' '.repeat(contractsIndent + step * 2)}provide: []`, eol };
        else inserted.push(...body);
      }

      relocations.push({ keyIndex: index, endIndex, anchorIndex: contractsIndex, lines: inserted, refs, minted: false });
      index = endIndex - 1;
      continue;
    }

    // No container yet: one is minted where the old key stood, so the refs keep their place in the
    // service and the surrounding keys keep their order.
    const step = 2;
    const minted: SourceLine[] = [
      { text: `${' '.repeat(indent)}contracts:`, eol },
      { text: `${' '.repeat(indent + step)}inprocess:`, eol },
      inlineBody === ''
        ? { text: `${' '.repeat(indent + step * 2)}provide:`, eol }
        : { text: `${' '.repeat(indent + step * 2)}provide: ${inlineBody}`, eol },
    ];
    if (inlineBody === '') {
      const body = shiftRegion(lines, index + 1, endIndex, indent + step * 3);
      if (body.length === 0) minted[2] = { text: `${' '.repeat(indent + step * 2)}provide: []`, eol };
      else minted.push(...body);
    }

    relocations.push({ keyIndex: index, endIndex, anchorIndex: index, lines: minted, refs, minted: true });
    index = endIndex - 1;
  }

  return { relocations, warnings };
}

/** One pass over the file applying every relocation: each removes its region and splices at its anchor. */
function rewrite(lines: SourceLine[], relocations: Relocation[]): SourceLine[] {
  const removeFrom = new Map<number, number>();
  const insertAfter = new Map<number, SourceLine[]>();
  const replaceAt = new Map<number, SourceLine[]>();

  for (const relocation of relocations) {
    removeFrom.set(relocation.keyIndex, relocation.endIndex);
    if (relocation.minted) replaceAt.set(relocation.keyIndex, relocation.lines);
    else insertAfter.set(relocation.anchorIndex, relocation.lines);
  }

  const out: SourceLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const removeTo = removeFrom.get(index);
    if (removeTo !== undefined) {
      const replacement = replaceAt.get(index);
      if (replacement) {
        // The last generated line inherits the last removed line's terminator, so a region that
        // ended the file does not gain one.
        const tail = lines[removeTo - 1]!.eol;
        out.push(...replacement.slice(0, -1), { text: replacement[replacement.length - 1]!.text, eol: tail });
      }
      index = removeTo - 1;
      continue;
    }
    out.push(lines[index]!);
    const inserted = insertAfter.get(index);
    if (inserted) out.push(...inserted);
  }
  return out;
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
    const stale = text.match(/\bhandles:/g);
    if (!stale) continue;
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    warnings.push(`${relativePath}: ${stale.length} mention(s) of \`handles:\` in prose - rewrite by hand`);
  }

  for (const absolutePath of yaml) {
    const relativePath = path.relative(blueprintDir, absolutePath).split(path.sep).join('/');
    const original = fs.readFileSync(absolutePath, 'utf8');

    if (original.includes('provides:')) {
      const hits = readLines(absolutePath).filter((line) => PROVIDES_KEY.test(line.text)).length;
      if (hits > 0) warnings.push(`${relativePath}: ${hits} \`provides:\` key(s) - removed from the schema in v2.8.27 with no replacement; delete or re-declare by hand`);
    }

    if (!original.includes('handles:')) continue;

    const lines = readLines(absolutePath);
    const { relocations, warnings: fileWarnings } = planFile(lines, relativePath);
    warnings.push(...fileWarnings);
    if (relocations.length === 0) continue;

    const text = joinLines(rewrite(lines, relocations));
    if (text === original) continue;

    const refs = relocations.reduce((total, relocation) => total + relocation.refs, 0);
    const minted = relocations.filter((relocation) => relocation.minted).length;
    files.push({ absolutePath, relativePath, rewritten: text, services: relocations.length, refs, minted });

    const parts = [`${relocations.length} service(s), ${refs} ref(s) to \`contracts.inprocess.provide\``];
    if (minted > 0) parts.push(`${minted} \`contracts:\` block(s) minted`);
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
    "`handles` becomes `contracts.inprocess.provide` (v2.8.27): a service's owned operations move under the coupling that carries them, into the existing `contracts:` block or into one minted where the old key stood",
  plan: buildPlan,
  apply: applyPlan,
};
