/**
 * Identity + provenance helpers (DEC-ATL-12, DEC-ATL-13).
 *
 * Internal processing uses source-true addresses (file + JSON Pointer); the
 * documentation surface uses stable slugs/anchors derived from — but not
 * replacing — that source identity.
 */
import type { Provenance, SourceRef } from './types.js';

/** Repo-relative base where versioned schema bundles live. */
export const SCHEMA_BASE = 'schema';

/** `design/domain.schema.yaml` → `design-domain`. Stable, kebab-case, unique per file. */
export function fileSlug(relPath: string): string {
  return relPath
    .replace(/\.schema\.ya?ml$/i, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();
}

/** Markdown anchor (GitHub style) for a heading text. */
export function anchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Build a source-true reference. */
export function sourceRef(version: string, file: string, pointer = ''): SourceRef {
  return { version, file, pointer };
}

/** Repo-relative, openable rendering of a source ref, e.g. `schema/v2.7/design/domain.schema.yaml#/$defs/operation`. */
export function formatSourceRef(ref: SourceRef): string {
  const base = `${SCHEMA_BASE}/${ref.version}/${ref.file}`;
  return ref.pointer ? `${base}#${ref.pointer}` : base;
}

/** Parse `file[#pointer]` (an overlay target) into a partial source ref (version supplied by caller). */
export function parseTargetAddress(version: string, target: string): SourceRef {
  const hashIdx = target.indexOf('#');
  if (hashIdx === -1) return sourceRef(version, target, '');
  return sourceRef(version, target.slice(0, hashIdx), target.slice(hashIdx + 1));
}

/** Render a compact provenance footnote block for a page or section. */
export function renderProvenance(prov: Provenance): string {
  const lines: string[] = [];
  const schema = prov.schema.map(formatSourceRef);
  if (schema.length === 1) {
    lines.push(`_Source: \`${schema[0]}\`_`);
  } else if (schema.length > 1) {
    lines.push('_Sources:_');
    for (const s of schema) lines.push(`- \`${s}\``);
  }
  if (prov.overlays && prov.overlays.length > 0) {
    lines.push(`_Overlay (non-authoritative): ${prov.overlays.map((o) => `\`${o}\``).join(', ')}_`);
  }
  return lines.join('\n');
}

/** Single-line provenance for use inside list items (changelog bullets). */
export function renderProvenanceInline(prov: Provenance): string {
  const schema = prov.schema.map(formatSourceRef).map((s) => `\`${s}\``);
  const parts: string[] = [];
  if (schema.length > 0) parts.push(`Source${schema.length > 1 ? 's' : ''}: ${schema.join(', ')}`);
  if (prov.overlays && prov.overlays.length > 0) {
    parts.push(`overlay: ${prov.overlays.map((o) => `\`${o}\``).join(', ')}`);
  }
  return parts.join(' · ');
}
