/**
 * Layer map page — per-plane structure with bounded dependency diagrams (Step 03).
 */
import { generatedBanner, table, cell, truncate, blocks } from '../md.js';
import { fileSlug } from '../provenance.js';
import { planeDependencyDiagram } from '../mermaid.js';
import type { GenContext } from './context.js';

export function renderLayerMap(ctx: GenContext, includeMermaid: boolean): string {
  const { model, policy } = ctx;
  const parts: string[] = [generatedBanner()];

  parts.push(`# Blueprint Schema Atlas — ${model.version} Layer Map`);
  parts.push(
    'Planes group schema files by concern. Dependency diagrams are **bounded per plane** so structure ' +
      'stays readable rather than flattened into one giant graph (DEC-ATL-14).',
  );

  for (const plane of model.planes) {
    if (plane.files.length === 0) continue;
    parts.push(`## ${plane.title}`);
    parts.push(plane.description);

    const rows = plane.files.map((rel) => {
      const f = model.files.find((x) => x.relPath === rel)!;
      const objectDefs = f.definitions.filter((d) => d.kind === 'object').length;
      return [
        `[\`${rel}\`](./entity-catalog.md#${fileSlug(rel)})`,
        cell(f.title),
        String(f.properties.length),
        String(objectDefs),
        truncate(f.description, 120),
      ];
    });
    parts.push(table(['Schema file', 'Title', 'Root props', 'Object defs', 'Summary'], rows));

    if (includeMermaid) {
      const diagram = planeDependencyDiagram(model, plane.id, policy);
      if (diagram) {
        parts.push(`### ${plane.title} — reference dependencies`);
        parts.push(diagram);
      }
    }
  }

  parts.push('---');
  parts.push('_Sources: all schema files under this version root. See per-file provenance in the [entity catalog](./entity-catalog.md)._');
  return blocks(...parts) + '\n';
}
