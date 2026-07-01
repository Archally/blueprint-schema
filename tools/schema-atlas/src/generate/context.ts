/**
 * Shared generation context + overlay attachment helper.
 */
import type { AtlasModel, OverlayEntry, Provenance, SourceRef } from '../types.js';
import type { PolicyReporter } from '../policy.js';
import { renderProvenance } from '../provenance.js';

export interface GenContext {
  model: AtlasModel;
  /** Overlay entries keyed by their (version-relative) target address. */
  overlayIndex: Map<string, { entry: OverlayEntry; overlayId: string }[]>;
  policy: PolicyReporter;
}

/** Look up overlay entries attached to a target address. */
export function overlaysFor(ctx: GenContext, target: string): { entry: OverlayEntry; overlayId: string }[] {
  return ctx.overlayIndex.get(target) ?? [];
}

/**
 * Render overlay notes for a target as a labeled, non-authoritative block, and
 * collect contributing overlay ids into `provenance` so it stays traceable.
 */
export function renderOverlayNotes(
  ctx: GenContext,
  target: string,
  provenance: Provenance,
): string {
  const hits = overlaysFor(ctx, target).filter((h) => h.entry.note);
  if (hits.length === 0) return '';
  const lines: string[] = [];
  for (const { entry, overlayId } of hits) {
    provenance.overlays = [...new Set([...(provenance.overlays ?? []), overlayId])];
    lines.push(`> **Note (${entry.category}, non-authoritative):** ${entry.note}`);
  }
  return lines.join('\n>\n');
}

/** Convenience: build a provenance object from source refs. */
export function prov(...schema: SourceRef[]): Provenance {
  return { schema };
}

export { renderProvenance };
