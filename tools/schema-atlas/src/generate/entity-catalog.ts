/**
 * Entity catalog — every schema file's root object + `$defs`, with properties,
 * requiredness, enums, deprecation, and attached overlay notes (Step 03).
 *
 * This is the deep reference view. Structure is preserved (root vs definitions,
 * object vs value defs); readability comes from per-plane grouping + a TOC, not
 * from flattening (DEC-ATL-14). Every file section shows its source (DEC-ATL-12).
 */
import type { DefInfo, PropertyInfo, Provenance, SchemaFile } from '../types.js';
import { generatedBanner, table, cell, truncate, code, blocks } from '../md.js';
import { fileSlug, formatSourceRef, renderProvenance } from '../provenance.js';
import { type GenContext, renderOverlayNotes, prov } from './context.js';

function enumSummary(values: string[] | undefined): string {
  if (!values || values.length === 0) return '';
  const shown = values.slice(0, 6).map((v) => `\`${v}\``);
  return values.length > 6 ? `${shown.join(', ')} … (${values.length})` : shown.join(', ');
}

function propRows(props: PropertyInfo[]): string[][] {
  return props.map((p) => {
    const desc = p.deprecated ? `⚠ *deprecated* — ${truncate(p.description, 140)}` : truncate(p.description, 160);
    return [
      code(p.name),
      code(p.type.label),
      p.required ? '✓' : '—',
      enumSummary(p.enumValues),
      cell(desc),
    ];
  });
}

const PROP_HEADER = ['Property', 'Type', 'Req', 'Enum', 'Description'];

function renderDef(def: DefInfo, file: SchemaFile, ctx: GenContext): string {
  const parts: string[] = [];
  parts.push(`#### \`${def.name}\`${def.title ? ` — ${cell(def.title)}` : ''}`);
  if (def.deprecated) parts.push('> ⚠ **Deprecated definition.**');
  if (def.description) parts.push(truncate(def.description, 400));

  const provenance: Provenance = prov({ version: file.source.version, file: file.relPath, pointer: def.pointer });
  const overlayTarget = `${file.relPath}#${def.pointer}`;
  const notes = renderOverlayNotes(ctx, overlayTarget, provenance);

  if (def.kind === 'object') {
    if (def.required.length > 0) parts.push(`**Required:** ${def.required.map((r) => `\`${r}\``).join(', ')}`);
    if (def.properties.length > 0) parts.push(table(PROP_HEADER, propRows(def.properties)));
    else parts.push('_No declared properties (open or composed object)._');
  } else {
    const detail = def.enumValues && def.enumValues.length > 0 ? enumSummary(def.enumValues) : code(def.type.label);
    parts.push(`**Type:** ${code(def.type.label)}${def.enumValues ? ` · **Values:** ${detail}` : ''}`);
  }

  if (notes) parts.push(notes);
  parts.push(renderProvenance(provenance));
  return blocks(...parts);
}

function renderFile(file: SchemaFile, ctx: GenContext): string {
  const parts: string[] = [];
  parts.push(`<a id="${file.slug}"></a>`);
  parts.push(`### \`${file.relPath}\``);
  if (file.title) parts.push(`**${cell(file.title)}**`);
  if (file.description) parts.push(truncate(file.description, 500));

  const fileProv: Provenance = prov(file.source);
  const fileNotes = renderOverlayNotes(ctx, file.relPath, fileProv);
  parts.push(`_Source: \`${formatSourceRef(file.source)}\`${file.rootType ? ` · root type \`${file.rootType}\`` : ''}_`);
  if (fileNotes) parts.push(fileNotes);

  // Root object.
  if (file.properties.length > 0) {
    if (file.required.length > 0) {
      parts.push(`**Root required:** ${file.required.map((r) => `\`${r}\``).join(', ')}`);
    }
    parts.push('**Root properties:**');
    parts.push(table(PROP_HEADER, propRows(file.properties)));
  }

  // Definitions — object defs first (the entity shapes), then value defs (the vocabulary).
  const objectDefs = file.definitions.filter((d) => d.kind === 'object');
  const valueDefs = file.definitions.filter((d) => d.kind === 'value');

  if (objectDefs.length > 0) {
    parts.push('#### Definitions');
    for (const def of objectDefs) parts.push(renderDef(def, file, ctx));
  }
  if (valueDefs.length > 0) {
    parts.push('#### Value definitions');
    const rows = valueDefs.map((d) => [
      code(d.name),
      code(d.type.label),
      enumSummary(d.enumValues),
      truncate(d.description, 160),
    ]);
    parts.push(table(['Definition', 'Type', 'Values', 'Description'], rows));
  }

  return blocks(...parts);
}

export function renderEntityCatalog(ctx: GenContext): string {
  const { model } = ctx;
  const parts: string[] = [generatedBanner()];
  parts.push(`# Blueprint Schema Atlas — ${model.version} Entity Catalog`);
  parts.push(
    'Every schema file, its root object, and its definitions — with types, requiredness, enums, and ' +
      'deprecation read directly from JSON Schema. Overlay notes are labeled non-authoritative (DEC-ATL-17).',
  );

  // TOC by plane.
  for (const plane of model.planes) {
    if (plane.files.length === 0) continue;
    parts.push(`**${plane.title}:** ` + plane.files.map((rel) => `[\`${rel}\`](#${fileSlug(rel)})`).join(' · '));
  }

  for (const plane of model.planes) {
    if (plane.files.length === 0) continue;
    parts.push(`## ${plane.title}`);
    for (const rel of plane.files) {
      const file = model.files.find((f) => f.relPath === rel)!;
      parts.push(renderFile(file, ctx));
    }
  }

  return blocks(...parts) + '\n';
}
