/**
 * Atlas changelog page (Step 04) — a structural, human-usable view of schema
 * evolution. Complements (does not replace) the root release ledger (DEC-ATL-04).
 */
import type { ChangeEntry, SchemaDiff } from '../types.js';
import { generatedBanner, table, cell, blocks } from '../md.js';
import { renderProvenanceInline } from '../provenance.js';
import { type GenContext, overlaysFor } from './context.js';

const KIND_TITLE: Record<ChangeEntry['kind'], string> = {
  remove: 'Removed',
  rename: 'Renamed',
  'requiredness-change': 'Requiredness changed',
  deprecate: 'Deprecated',
  modify: 'Modified',
  add: 'Added',
};

const KIND_ORDER: ChangeEntry['kind'][] = ['remove', 'rename', 'requiredness-change', 'deprecate', 'modify', 'add'];

export function renderChangelog(ctx: GenContext, diff: SchemaDiff): string {
  const parts: string[] = [generatedBanner()];
  parts.push('# Blueprint Schema Atlas — Changelog');
  parts.push(
    `A generated structural changelog for the **\`${diff.from}\` → \`${diff.to}\`** diff path. It explains ` +
      '*what changed and why it matters to schema consumers* (DEC-ATL-16).',
  );
  parts.push(
    '> **Relationship to the release ledger:** the root [`CHANGELOG.md`](../../CHANGELOG.md) remains the ' +
      'authoritative release ledger (dates, version summaries). This page is the richer *structural* view, ' +
      'derived from the schema diff (DEC-ATL-04). Where the two disagree on wording, the root ledger wins ' +
      'on release facts; this page wins on structural detail.',
  );

  // Summary table.
  const bySemver = { major: 0, minor: 0, patch: 0 };
  const byKind: Record<string, number> = {};
  for (const c of diff.changes) {
    bySemver[c.semver]++;
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  }
  parts.push('## Summary');
  parts.push(
    table(
      ['Impact', 'Count'],
      [
        ['Breaking (major)', String(bySemver.major)],
        ['Additive (minor)', String(bySemver.minor)],
        ['Clarification (patch)', String(bySemver.patch)],
        ['**Total changes**', String(diff.changes.length)],
      ],
    ),
  );

  if (bySemver.major > 0) {
    const breaking = diff.changes.filter((c) => c.semver === 'major');
    parts.push('## ⚠ Breaking changes');
    parts.push(
      table(
        ['Change', 'Target', 'Summary'],
        breaking.map((c) => [KIND_TITLE[c.kind], cell(c.target), cell(stripCode(c.summary))]),
      ),
    );
  }

  // Grouped detail.
  for (const kind of KIND_ORDER) {
    const items = diff.changes.filter((c) => c.kind === kind);
    if (items.length === 0) continue;
    parts.push(`## ${KIND_TITLE[kind]} (${items.length})`);
    for (const c of items) {
      parts.push(renderChange(ctx, c));
    }
  }

  if (diff.changes.length === 0) {
    parts.push('_No structural changes detected on this diff path._');
  }

  parts.push('---');
  parts.push('_Structural diff generated from the two schema versions. Rename claims are conservative (DEC-ATL-19): `add`/`remove` unless explicitly annotated._');
  return blocks(...parts) + '\n';
}

function stripCode(s: string): string {
  return s.replace(/`/g, '');
}

function renderChange(ctx: GenContext, c: ChangeEntry): string {
  const parts: string[] = [];
  const badge = c.semver === 'major' ? '**[breaking]**' : c.semver === 'minor' ? '[additive]' : '[patch]';
  parts.push(`- ${badge} \`${c.target}\` — ${c.summary}`);
  if (c.renameBasis) parts.push(`  - _Rename basis: ${c.renameBasis}_`);
  if (c.note) parts.push(`  - _Note: ${c.note}_`);

  // Attach changelog-rationale overlay notes targeting this change.
  const overlayHits = overlaysFor(ctx, c.target).filter((h) => h.entry.category === 'changelog-rationale' && h.entry.note);
  const provenance = { ...c.provenance, overlays: c.provenance.overlays ? [...c.provenance.overlays] : undefined };
  for (const h of overlayHits) {
    provenance.overlays = [...new Set([...(provenance.overlays ?? []), h.overlayId])];
    parts.push(`  - _Rationale (non-authoritative): ${h.entry.note}_`);
  }

  const prov = renderProvenanceInline(provenance);
  if (prov) parts.push(`  - _${prov}_`);
  return parts.join('\n');
}
