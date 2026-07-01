/**
 * Overview / layer-map landing page for one schema version (Step 03).
 * Answers "what exists / where" without raw JSON Schema reading.
 */
import type { AtlasModel } from '../types.js';
import { generatedBanner, table, cell, truncate, blocks } from '../md.js';
import { fileSlug, formatSourceRef, sourceRef } from '../provenance.js';
import { planeMapDiagram } from '../mermaid.js';
import type { GenContext } from './context.js';

export function renderOverview(ctx: GenContext, includeMermaid: boolean): string {
  const { model } = ctx;
  const parts: string[] = [generatedBanner()];

  parts.push(`# Blueprint Schema Atlas — ${model.version} Overview`);
  parts.push(
    'A generated, human-readable projection of the JSON Schema. **JSON Schema remains the source of truth** ' +
      '(DEC-ATL-01); this page is a projection (DEC-ATL-02) and must not be hand-edited.',
  );

  // Counts.
  const objectDefs = model.files.reduce((n, f) => n + f.definitions.filter((d) => d.kind === 'object').length, 0);
  parts.push(
    table(
      ['Metric', 'Count'],
      [
        ['Schema files', String(model.files.length)],
        ['Planes', String(model.planes.filter((p) => p.files.length > 0).length)],
        ['Object definitions', String(objectDefs)],
        ['Typed-ID entity types', String(model.entityTypes.length)],
        ['Cross-file reference edges', String(model.relations.length)],
      ].map((r) => r.map(cell)),
    ),
  );

  if (includeMermaid) {
    parts.push('## Plane map', planeMapDiagram(model));
  }

  // Per-plane file listing.
  for (const plane of model.planes) {
    if (plane.files.length === 0) continue;
    parts.push(`## ${plane.title}`);
    parts.push(plane.description);
    const rows = plane.files.map((rel) => {
      const f = model.files.find((x) => x.relPath === rel)!;
      return [
        `[\`${rel}\`](./entity-catalog.md#${fileSlug(rel)})`,
        cell(f.title),
        truncate(f.description, 140),
      ];
    });
    parts.push(table(['Schema file', 'Title', 'Summary'], rows));
  }

  parts.push('## Navigate');
  parts.push(
    [
      '- **[Layer map](./layer-map.md)** — planes, files, and dependency diagrams',
      '- **[Entity catalog](./entity-catalog.md)** — every object definition, its properties, requiredness, and enums',
      '- **[Relationships](./relationships.md)** — typed-ID vocabulary and cross-file references',
      '- **[Examples](./examples.md)** — schema-native and curated examples',
      '- **[Changelog](../changelog.md)** — schema evolution across versions',
    ].join('\n'),
  );

  parts.push('---');
  parts.push(`_Source: \`${formatSourceRef(sourceRef(model.version, '', ''))}\` (all files under this version root)_`);

  return blocks(...parts) + '\n';
}
