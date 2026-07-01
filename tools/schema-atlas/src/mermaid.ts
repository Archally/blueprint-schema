/**
 * Mermaid diagram generation — bounded structural views (DEC-ATL-05, DEC-ATL-14).
 *
 * Readability is achieved by BOUNDING views (per plane), not by flattening schema
 * structure. When a view would exceed a readability threshold, the reporter records
 * a `warn` (the view is still emitted, honestly labeled) rather than silently
 * dropping edges.
 */
import type { AtlasModel, PlaneId } from './types.js';
import type { PolicyReporter } from './policy.js';

/** Above this edge count a single dependency diagram is flagged as dense (still rendered). */
const EDGE_READABILITY_LIMIT = 40;

export function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

export function escapeMermaid(text: string): string {
  return text.replace(/"/g, "'");
}

function fence(lines: string[]): string {
  return ['```mermaid', ...lines, '```'].join('\n');
}

/** Short display label for a file node — its base name without the `.schema.yaml` suffix. */
function fileLabel(relPath: string): string {
  const base = relPath.replace(/^.*\//, '').replace(/\.schema\.ya?ml$/i, '');
  return base;
}

/** Top-level plane map: the three planes with their file counts. */
export function planeMapDiagram(model: AtlasModel): string {
  const lines = ['graph TD'];
  lines.push(`    ROOT["Blueprint ${model.version}"]`);
  for (const plane of model.planes) {
    const pid = sanitizeMermaidId(plane.id);
    lines.push(`    ${pid}["${escapeMermaid(plane.title)}<br/>${plane.files.length} schema files"]`);
    lines.push(`    ROOT --> ${pid}`);
  }
  return fence(lines);
}

/**
 * Per-plane file dependency diagram. Nodes = files in the plane plus any
 * cross-cutting files they reference; edges = aggregated `$ref` relations.
 */
export function planeDependencyDiagram(
  model: AtlasModel,
  planeId: PlaneId,
  policy: PolicyReporter,
): string {
  const plane = model.planes.find((p) => p.id === planeId);
  if (!plane || plane.files.length === 0) return '';
  const inPlane = new Set(plane.files);

  // Edges originating from this plane's files.
  const edges = model.relations.filter((r) => inPlane.has(r.fromFile));
  const nodes = new Set<string>(plane.files);
  for (const e of edges) nodes.add(e.toFile);

  if (edges.length > EDGE_READABILITY_LIMIT) {
    policy.warn(
      'diagram-dense',
      `${plane.title} dependency diagram has ${edges.length} edges (> ${EDGE_READABILITY_LIMIT}); rendered whole but consider reading the relationship table for detail.`,
    );
  }

  const lines = ['graph LR'];
  // Group in-plane files in a subgraph to preserve the boundary visually.
  lines.push(`    subgraph ${sanitizeMermaidId(plane.id)}_plane["${escapeMermaid(plane.title)}"]`);
  for (const f of plane.files) {
    lines.push(`        ${sanitizeMermaidId(f)}["${escapeMermaid(fileLabel(f))}"]`);
  }
  lines.push('    end');
  // Cross-cutting/out-of-plane targets rendered outside the subgraph.
  for (const n of [...nodes].sort()) {
    if (inPlane.has(n)) continue;
    lines.push(`    ${sanitizeMermaidId(n)}(["${escapeMermaid(fileLabel(n))}"])`);
  }
  for (const e of [...edges].sort((a, b) => a.fromFile.localeCompare(b.fromFile) || a.toFile.localeCompare(b.toFile))) {
    lines.push(`    ${sanitizeMermaidId(e.fromFile)} -->|${e.count}| ${sanitizeMermaidId(e.toFile)}`);
  }
  return fence(lines);
}
