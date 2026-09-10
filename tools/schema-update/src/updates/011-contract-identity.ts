import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// A contract's `output:` fused three facts into one string (v2.8.14): the document's name, where the
// artifact lands, and how it is serialized. This module states them separately - `contract_name`
// names the document, `slice` or `cross_cutting` places it, and the contract KIND selects the
// format, so the name carries neither a path nor an extension.
//
// TEXTUAL, like `007` and `010`: a line scan with no YAML parse, so comments, key order, quoting and
// line endings survive. What differs is that one line becomes two - `output:` is replaced in place
// by the keys that supersede it, at its own indent.
//
// THE PREFIX DECIDES, AND THE VOCABULARY IS THE DECLARED ONE. `layout.slices[].name` from the model
// root, not the directories on disk: a validator reports a `slice:` naming a slice the model does
// not declare, so a migration reading the folder names would create the very warning it is meant to
// leave behind. A prefix that is neither a declared slice, `_global`, nor a build folder is REPORTED
// and its declaration is left untouched - inventing a placement from a value nobody recognises is
// the one outcome worth less than doing nothing.
//
// THE NAME IS THE BASENAME UP TO ITS FIRST DOT. Measured across every model directory in this
// repository: 351 declarations, 0 names failing the `contract_name` pattern, and 0 collisions -
// no two declarations that name different documents today come to name one.
//
// IDEMPOTENT BY CONSTRUCTION. A contract already carrying `contract_name` has no `output:` line to
// match, so a second run plans nothing.

/** The kind keys a service declares contracts under. */
const CONTRACT_KINDS = new Set([
  'openapi', 'httpClient', 'asyncapi', 'openrpc', 'arazzo', 'cncfsw', 'graphql',
]);

/**
 * Prefixes that name a build folder rather than a slice.
 *
 * Dropped, and reported per declaration: the prefix was a statement about where an artifact landed,
 * and deleting a statement is not the same as reformatting one. Placement is the render layer's now.
 */
const BUILD_FOLDERS = new Set(['dist', 'generated', 'specs', 'out', 'build']);

const YAML_FILE = /\.(yaml|yml)$/i;
/** Any `key:` line, with its indent, its key and whatever follows on the same line. */
const KEY_LINE = /^(\s*)(?:-\s+)?([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/;
/** The `output:` line itself, keeping the exact leading text so the replacement lands at its indent. */
const OUTPUT_LINE = /^(\s*)(-\s+)?output:\s*(.*?)\s*$/;

/** The name a declared value resolves to: the basename, up to its first dot. */
export function contractNameOf(value: string): string {
  const base = value.replace(/\\/g, '/').split('/').pop() ?? value;
  const dot = base.indexOf('.');
  return dot < 0 ? base : base.slice(0, dot);
}

/** Strip one layer of YAML quoting, if the value carries it. */
function unquote(raw: string): string {
  const match = raw.match(/^(["'])(.*)\1$/);
  return match ? match[2]! : raw;
}

export interface ContractSplit {
  /** The lines that replace the `output:` line, in order. */
  lines: string[];
  /** Set when the declaration was left alone, carrying the reason. */
  refused?: string;
  /** Set when a statement was dropped rather than restated. */
  dropped?: string;
}

/**
 * Split one declared `output:` value into the keys that supersede it.
 *
 * `indent` is the exact leading whitespace of the line being replaced, so the result sits where the
 * original sat regardless of how the file is indented.
 */
export function splitOutput(value: string, indent: string, slices: ReadonlySet<string>): ContractSplit {
  const normalized = value.replace(/\\/g, '/');
  const name = contractNameOf(normalized);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    return { lines: [], refused: `"${value}" yields no usable contract name` };
  }

  const cut = normalized.indexOf('/');
  const prefix = cut > 0 ? normalized.slice(0, cut) : null;
  const named = `${indent}contract_name: ${name}`;

  if (!prefix) return { lines: [named] };
  if (prefix === '_global') return { lines: [named, `${indent}cross_cutting: true`] };
  if (slices.has(prefix)) return { lines: [named, `${indent}slice: ${prefix}`] };
  if (BUILD_FOLDERS.has(prefix)) {
    return { lines: [named], dropped: `"${prefix}/" named a build folder, not a slice` };
  }
  return { lines: [], refused: `"${prefix}/" is neither a declared slice nor a build folder` };
}

/** The enclosing key of a line, tracked by indent so nesting depth is never assumed. */
interface Frame { indent: number; key: string }

function indentOf(line: string): number {
  return line.length - line.replace(/^\s*/, '').length;
}

export interface FileRewrite {
  text: string;
  /** How many `output:` declarations became `contract_name` + a placement. */
  split: number;
  /** Declarations left untouched, each with its reason. */
  refusals: string[];
  /** Build-folder prefixes dropped, each named. */
  drops: string[];
}

/**
 * Rewrite every contract `output:` in one arch file's text.
 *
 * A line is a contract's `output:` only when its enclosing key is a contract kind and THAT key's
 * enclosing key is `contracts` - so a resource's `output:`, or a prose key of the same name
 * anywhere else in the tree, is never touched.
 */
export function rewriteContractOutputs(text: string, slices: ReadonlySet<string>): FileRewrite {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  const stack: Frame[] = [];
  const refusals: string[] = [];
  const drops: string[] = [];
  let split = 0;

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) { out.push(line); continue; }
    const depth = indentOf(line);
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= depth) stack.pop();

    const output = line.match(OUTPUT_LINE);
    const parent = stack[stack.length - 1];
    const grandparent = stack[stack.length - 2];
    if (output && parent && CONTRACT_KINDS.has(parent.key) && grandparent?.key === 'contracts') {
      const value = unquote(output[3]!);
      if (value === '') { out.push(line); continue; }
      // A list-dash `output:` is not a contract's own key; leave it and say so rather than
      // rewriting a line whose shape this transform was not designed for.
      if (output[2]) {
        refusals.push(`"${value}" is a list entry, not a contract's own key`);
        out.push(line);
        continue;
      }
      const result = splitOutput(value, output[1]!, slices);
      if (result.refused) { refusals.push(result.refused); out.push(line); continue; }
      if (result.dropped) drops.push(result.dropped);
      out.push(...result.lines);
      split += 1;
      continue;
    }

    const key = line.match(KEY_LINE);
    if (key) stack.push({ indent: depth, key: key[2]! });
    out.push(line);
  }

  return { text: out.join(newline), split, refusals, drops };
}

/** The `contract.file` of a test case, rewritten to the name the arch layer now declares. */
export function rewriteTestCaseContractFiles(text: string): { text: string; rewritten: number } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const stack: Frame[] = [];
  let rewritten = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const depth = indentOf(line);
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= depth) stack.pop();

    const match = line.match(/^(\s*)file:\s*(.*?)\s*$/);
    if (match && stack[stack.length - 1]?.key === 'contract') {
      const value = unquote(match[2]!);
      const name = contractNameOf(value);
      if (value !== '' && value !== name && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
        lines[index] = `${match[1]}file: ${name}`;
        rewritten += 1;
        continue;
      }
    }
    const key = line.match(KEY_LINE);
    if (key) stack.push({ indent: depth, key: key[2]! });
  }

  return { text: lines.join(newline), rewritten };
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

/**
 * The slices the model DECLARES, read from `layout.slices[].name` without a YAML parse.
 *
 * The same list the validator checks a `slice:` against - see the note at the top of this file for
 * why the directories on disk are the wrong source.
 */
export function declaredSliceNames(modelDir: string): Set<string> {
  const names = new Set<string>();
  const root = path.join(modelDir, 'blueprint.yaml');
  if (!fs.existsSync(root)) return names;
  const lines = fs.readFileSync(root, 'utf8').split(/\r?\n/);
  let inSlices: number | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const opens = line.match(/^(\s*)slices:\s*$/);
    if (opens) { inSlices = opens[1]!.length; continue; }
    if (inSlices === null) continue;
    if (indentOf(line) <= inSlices) { inSlices = null; continue; }
    const name = line.match(/^\s*-?\s*name:\s*["']?([a-z][a-z0-9-]*)["']?\s*$/);
    if (name) names.add(name[1]!);
  }
  return names;
}

function analyse(modelDir: string): { changes: PlannedChange[]; warnings: string[] } {
  const slices = declaredSliceNames(modelDir);
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];
  for (const file of walkYaml(modelDir).sort()) {
    const relative = path.relative(modelDir, file);
    const before = fs.readFileSync(file, 'utf8');
    const contracts = rewriteContractOutputs(before, slices);
    if (contracts.split > 0) {
      changes.push({
        type: 'edit-yaml',
        path: relative,
        detail: `${contracts.split} contract output(s) split into contract_name + placement`,
      });
    }
    for (const dropped of contracts.drops) {
      warnings.push(`${relative}: ${dropped} - the prefix is gone and the render layer places the artifact now.`);
    }
    for (const refused of contracts.refusals) {
      warnings.push(`${relative}: left untouched, ${refused}. Split it by hand.`);
    }
    const testCases = rewriteTestCaseContractFiles(before);
    if (testCases.rewritten > 0) {
      changes.push({
        type: 'edit-yaml',
        path: relative,
        detail: `${testCases.rewritten} test case contract file(s) renamed to the contract's name`,
      });
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
    const slices = declaredSliceNames(modelDir);
    for (const file of walkYaml(modelDir).sort()) {
      const before = fs.readFileSync(file, 'utf8');
      const contracts = rewriteContractOutputs(before, slices);
      const testCases = rewriteTestCaseContractFiles(contracts.text);
      if (contracts.split > 0 || testCases.rewritten > 0) {
        fs.writeFileSync(file, testCases.text, 'utf8');
      }
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
    'Split a contract output into the facts it fused (v2.8.14): contract_name names the document, slice or cross_cutting places it, and the contract kind selects the serialization',
  plan: buildPlan,
  apply: applyPlan,
};
