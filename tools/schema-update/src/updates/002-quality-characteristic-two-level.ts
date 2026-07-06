import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

// v2.7.4 made `finding.quality_characteristic` strictly the ISO/IEC 25010:2011 top-level 8 (+ safety).
// The pre-2.7.4 enum mixed a top-level characteristic with four of its own maintainability
// sub-characteristics. Those four are no longer valid TOP-LEVEL values — they move to the new,
// optional `quality_subcharacteristic` field under `maintainability`. This migration remaps them:
//
//   quality_characteristic: modularity        quality_characteristic: maintainability
//                                        ==>   quality_subcharacteristic: modularity
//
// Data-only, block-style YAML, in place. `maintainability` (still a valid top-level value) is left
// untouched. No data is lost — the demoted value is preserved as the sub-characteristic.
const DEMOTED_TO_MAINTAINABILITY = ['modularity', 'analysability', 'reusability', 'testability'] as const;

// Matches a block-style `quality_characteristic: <demoted>` line, capturing indent + value + any
// trailing comment. `[ \t]` (not `\s`) so the newline is never consumed. `gm` = per-line, all lines.
const QC_LINE = new RegExp(
  `^([ \\t]*)quality_characteristic:[ \\t]*(${DEMOTED_TO_MAINTAINABILITY.join('|')})[ \\t]*(#[^\\n]*)?$`,
  'gm',
);

function walkYamlFiles(directory: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(fullPath));
    } else if (/\.(yaml|yml)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// A demoted value used inline (flow-style `{..., quality_characteristic: modularity, ...}`) is NOT
// matched by the block-style line regex — flag it so a human can fix it by hand rather than silently
// leaving an invalid value behind.
const INLINE_HINT = new RegExp(
  `quality_characteristic:[ \\t]*(${DEMOTED_TO_MAINTAINABILITY.join('|')})\\b`,
);

function buildPlan(blueprintDir: string): UpdatePlan {
  const absoluteDir = path.resolve(blueprintDir);
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(absoluteDir)) {
    return { sourceVersion: '2.7', targetVersion: '2.7', description: update.description, changes: [], warnings: [`Directory not found: ${absoluteDir}`] };
  }

  for (const filePath of walkYamlFiles(absoluteDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(absoluteDir, filePath);
    const blockMatches = [...content.matchAll(QC_LINE)];
    for (const match of blockMatches) {
      changes.push({
        type: 'edit-yaml',
        path: relativePath,
        detail: `quality_characteristic: ${match[2]} → maintainability + quality_subcharacteristic: ${match[2]}`,
      });
    }
    // Detect inline-flow occurrences the block regex can't safely rewrite.
    for (const line of content.split(/\r?\n/)) {
      if (INLINE_HINT.test(line) && !/^[ \t]*quality_characteristic:/.test(line)) {
        warnings.push(`${relativePath}: inline-flow quality_characteristic uses a demoted value — fix by hand: ${line.trim()}`);
      }
    }
  }

  if (changes.length === 0) {
    warnings.push('No findings use a demoted maintainability sub-characteristic as a top-level quality_characteristic — model is already 2.7.4-shaped.');
  }

  return { sourceVersion: '2.7', targetVersion: '2.7', description: update.description, changes, warnings };
}

function applyPlan(blueprintDir: string): UpdateResult {
  const plan = buildPlan(blueprintDir);
  const absoluteDir = path.resolve(blueprintDir);
  const errors: string[] = [];

  if (plan.changes.length === 0) {
    return { ...plan, applied: false, errors: [] };
  }

  const filesToEdit = new Set(plan.changes.map((c) => c.path));
  for (const relativePath of filesToEdit) {
    const filePath = path.join(absoluteDir, relativePath);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const updated = content.replace(
        QC_LINE,
        (_full, indent: string, value: string, comment?: string) =>
          `${indent}quality_characteristic: maintainability${comment ? ` ${comment}` : ''}\n${indent}quality_subcharacteristic: ${value}`,
      );
      fs.writeFileSync(filePath, updated, 'utf8');
    } catch (error) {
      errors.push(`Failed to edit ${relativePath}: ${(error as Error).message}`);
    }
  }

  return { ...plan, applied: errors.length === 0, errors };
}

export const update: SchemaUpdate = {
  sourceVersion: '2.7',
  targetVersion: '2.7',
  description:
    'Quality two-level (v2.7.4): remap findings whose quality_characteristic is a maintainability sub-characteristic (modularity/analysability/reusability/testability) to quality_characteristic: maintainability + quality_subcharacteristic: <value>',
  plan: buildPlan,
  apply: applyPlan,
};
