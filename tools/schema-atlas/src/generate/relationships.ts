/**
 * Relationship map — the typed-ID vocabulary (the legend) + cross-file references (Step 03).
 */
import { generatedBanner, table, cell, truncate, code, blocks } from '../md.js';
import { fileSlug, formatSourceRef, sourceRef } from '../provenance.js';
import type { GenContext } from './context.js';

export function renderRelationships(ctx: GenContext): string {
  const { model } = ctx;
  const parts: string[] = [generatedBanner()];
  parts.push(`# Blueprint Schema Atlas — ${model.version} Relationships`);
  parts.push(
    'Two relationship views: the **typed-ID vocabulary** (how entities reference each other inside a ' +
      'model) and the **cross-file references** (how schema files depend on each other). Both are derived ' +
      'from JSON Schema `$ref`s and metamodel patterns.',
  );

  // Typed-ID vocabulary.
  parts.push('## Typed-ID vocabulary');
  parts.push(
    'Metamodel `*_ref` definitions turn a model into a navigable graph — each entity type has an ID ' +
      'prefix (optionally context-prefixed, e.g. `billing.CN001`).',
  );
  const entityRows = model.entityTypes.map((e) => [
    code(e.idPrefix),
    code(e.name),
    truncate(e.description, 160),
  ]);
  parts.push(table(['ID prefix', 'Ref type', 'Description'], entityRows));
  parts.push(`_Source: \`${formatSourceRef(sourceRef(model.version, 'metamodel.schema.yaml', '/$defs'))}\`_`);

  // Cross-file references.
  parts.push('## Cross-file references');
  parts.push(
    'Aggregated `$ref` edges between schema files. The metamodel is the shared hub — most files import ' +
      'its definitions.',
  );

  // Most-referenced files (inbound).
  const inbound = new Map<string, number>();
  for (const r of model.relations) inbound.set(r.toFile, (inbound.get(r.toFile) ?? 0) + r.count);
  const topInbound = [...inbound.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  if (topInbound.length > 0) {
    parts.push('**Most referenced files:**');
    parts.push(
      table(
        ['Schema file', 'Inbound refs'],
        topInbound.map(([f, n]) => [`[\`${f}\`](./entity-catalog.md#${fileSlug(f)})`, String(n)]),
      ),
    );
  }

  // Full edge table.
  const edgeRows = model.relations
    .slice()
    .sort((a, b) => a.fromFile.localeCompare(b.fromFile) || a.toFile.localeCompare(b.toFile))
    .map((r) => [code(r.fromFile), code(r.toFile), String(r.count)]);
  parts.push('**All reference edges:**');
  parts.push(table(['From', 'To', 'Refs'], edgeRows.map((r) => r.map(cell))));

  parts.push('---');
  parts.push('_Sources: all schema files under this version root (`$ref` traversal). See the [entity catalog](./entity-catalog.md) for per-property refs._');
  return blocks(...parts) + '\n';
}
