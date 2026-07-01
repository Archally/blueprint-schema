/**
 * Examples page — schema-native first, curated overlay examples second (DEC-ATL-18).
 *
 * All examples are labeled as examples/projections, never validation authority, and
 * carry provenance. Repo example blueprints (validated model instances) are surfaced
 * as reference material.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AtlasModel } from '../types.js';
import { walkFiles, loadYaml, toPosixPath } from '../schema-io.js';
import { generatedBanner, table, cell, truncate, code, blocks } from '../md.js';
import { formatSourceRef, sourceRef } from '../provenance.js';
import { type GenContext } from './context.js';

interface NativeExample {
  file: string;
  pointer: string;
  value: unknown;
}

/** Recursively collect JSON Schema `examples` keyword instances (true schema-native examples). */
function collectNativeExamples(node: unknown, file: string, pointer: string, out: NativeExample[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectNativeExamples(item, file, `${pointer}/${i}`, out));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'examples' && Array.isArray(value)) {
      value.forEach((ex, i) => out.push({ file, pointer: `${pointer}/examples/${i}`, value: ex }));
    } else {
      collectNativeExamples(value, file, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, out);
    }
  }
}

/** Find example blueprint model dirs under `<repoRoot>/examples`. */
function findExampleBlueprints(repoRoot: string): string[] {
  const examplesDir = path.join(repoRoot, 'examples');
  if (!fs.existsSync(examplesDir)) return [];
  const dirs = walkFiles(examplesDir, (f) => /(?:^|[/\\])blueprint\.ya?ml$/i.test(f));
  return dirs.map((f) => toPosixPath(path.relative(repoRoot, path.dirname(f)))).sort();
}

export function renderExamples(ctx: GenContext, repoRoot: string): string {
  const { model, policy } = ctx;
  const parts: string[] = [generatedBanner()];
  parts.push(`# Blueprint Schema Atlas — ${model.version} Examples`);
  parts.push(
    'Examples are illustrative projections, **not validation authority**. Schema-native examples come first; ' +
      'curated examples are explicitly labeled and provenance-bearing (DEC-ATL-18).',
  );

  // 1. Schema-native examples.
  parts.push('## Schema-native examples');
  const native: NativeExample[] = [];
  try {
    const files = walkFiles(model.schemaRoot, (f) => /\.schema\.ya?ml$/i.test(f));
    for (const abs of files) {
      const rel = toPosixPath(path.relative(model.schemaRoot, abs));
      collectNativeExamples(loadYaml(abs), rel, '', native);
    }
  } catch (err) {
    policy.warn('examples-scan', `Could not scan schema-native examples: ${(err as Error).message}`);
  }
  if (native.length === 0) {
    policy.skip('examples-native-absent', `No JSON Schema \`examples\` keywords in ${model.version}; using curated + reference examples only.`);
    parts.push('_No JSON Schema `examples` keywords are declared in this version (this is expected — the schema documents shapes, not instances)._');
  } else {
    for (const ex of native.slice(0, 50)) {
      parts.push(`- \`${formatSourceRef(sourceRef(model.version, ex.file, ex.pointer))}\`: \`${truncate(JSON.stringify(ex.value), 120)}\``);
    }
    if (native.length > 50) {
      policy.warn('examples-native-truncated', `${native.length} schema-native examples found; listed first 50.`);
      parts.push(`_… and ${native.length - 50} more (listed first 50 for readability)._`);
    }
  }

  // 2. Reference example blueprints (validated model instances).
  parts.push('## Reference example models');
  parts.push('Full example blueprints in this repository, validated against the schema — the best way to see the schema in use.');
  const blueprints = findExampleBlueprints(repoRoot);
  if (blueprints.length === 0) {
    policy.skip('examples-blueprints-absent', 'No example blueprint models found under examples/.');
    parts.push('_None found under `examples/`._');
  } else {
    // This page lives at docs/schema-atlas/<version>/examples.md — links are relative to that dir.
    const pageDir = `docs/schema-atlas/${model.version}`;
    const rows = blueprints.map((dir) => {
      const overview = `${dir}/.specs/overview.md`;
      const hasOverview = fs.existsSync(path.join(repoRoot, overview));
      const link = hasOverview ? `[rendered overview](${path.posix.relative(pageDir, overview)})` : '—';
      return [code(dir), link];
    });
    parts.push(table(['Example model', 'Rendered overview'], rows.map((r) => r.map(cell))));
  }

  // 3. Curated overlay examples.
  const curated: { target: string; example: string; overlayId: string }[] = [];
  for (const [target, hits] of ctx.overlayIndex.entries()) {
    for (const h of hits) {
      if (h.entry.category === 'curated-example' && h.entry.example) {
        curated.push({ target, example: h.entry.example, overlayId: h.overlayId });
      }
    }
  }
  parts.push('## Curated examples (non-authoritative)');
  if (curated.length === 0) {
    policy.skip('examples-curated-absent', 'No curated overlay examples declared.');
    parts.push('_None declared. Curated examples live in overlays and are always labeled non-authoritative._');
  } else {
    for (const c of curated.sort((a, b) => a.target.localeCompare(b.target))) {
      parts.push(`**Example for \`${c.target}\`** _(curated, non-authoritative — overlay \`${c.overlayId}\`)_:`);
      parts.push('```yaml\n' + c.example.replace(/\s+$/, '') + '\n```');
    }
  }

  return blocks(...parts) + '\n';
}
