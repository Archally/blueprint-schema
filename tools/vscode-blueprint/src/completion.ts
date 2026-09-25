/**
 * Completion of blueprint id REFERENCES - the half a JSON Schema cannot do.
 *
 * The Red Hat YAML extension completes what the schema knows: property names, and enums such as
 * `implementation: as-is|wip|to-be|unclear`. It cannot complete an id, because the ids live in
 * sibling files the schema never reads, and it would have nothing to show if it could - `CMD001`
 * means nothing to a person. This provider closes that half using the index the extension already
 * maintains for go-to-definition.
 *
 * The design point is that it is not really completion, it is SEARCH. A model of any size holds
 * hundreds of ids and nobody remembers the number, so the id alone is useless as a label. Each item
 * therefore carries the entity's NAME, and `filterText` holds `"<id> <name>"` so the editor's own
 * fuzzy matcher finds `orders.CMD001` when the author types `subm` - the name is the query and the
 * id is what lands in the file.
 *
 * Pure logic, no `vscode` import, so it is unit-testable under `node --test`.
 */

import { ID_FIELD_PREFIXES } from './idFields.generated';

/** An indexed declaration, reduced to what a completion row needs. */
export interface IdEntry {
  id: string;
  /** Human-readable `name:` of the entity, when it declared one. */
  name: string;
  /** `kind:` / `stereotype:` / `type:`, when it declared one - shown as the row's category. */
  kind: string;
  /** Workspace-relative path of the declaring file, for the row's right-hand description. */
  file: string;
}

/** Where the cursor is: which field is being filled in, and the id fragment typed so far. */
export interface FieldContext {
  field: string;
  typed: string;
  /** Column where `typed` starts - the replacement range's left edge. */
  start: number;
}

/** A line that is only a key with no value: `  triggers_operations:` */
const EMPTY_KEY_RE = /^(\s*)(?:-\s+)?([A-Za-z_][A-Za-z0-9_]*):\s*$/;
/** A line holding a key and the start of a scalar value: `  screen: stor` */
const KEY_VALUE_RE = /^(\s*)(?:-\s+)?([A-Za-z_][A-Za-z0-9_]*):\s+(.*)$/;
/** A sequence item that is a bare scalar: `  - orders.CMD0` */
const SEQ_ITEM_RE = /^(\s*)-\s*(.*)$/;

/** The id fragment ending at the cursor - letters, digits, dots and hyphens. */
function fragmentBefore(text: string, character: number): { typed: string; start: number } {
  let start = character;
  while (start > 0 && /[A-Za-z0-9.\-_]/.test(text[start - 1])) start--;
  return { typed: text.slice(start, character), start };
}

const indentOf = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;

/**
 * Which field the cursor is filling in.
 *
 * Two shapes carry a reference: `field: <value>` on one line, and a `- <value>` sequence item whose
 * owning key sits on an earlier, less-indented line. Anything else returns undefined, so the
 * provider stays silent inside prose, comments and keys.
 */
export function fieldAtCursor(lines: string[], line: number, character: number): FieldContext | undefined {
  const current = lines[line];
  if (current === undefined) return undefined;

  const head = current.slice(0, character);
  if (head.includes('#')) return undefined; // a comment - never complete

  // `field: value` (optionally the first key of a `- ` item).
  const keyValue = current.match(KEY_VALUE_RE);
  if (keyValue) {
    const valueStart = current.indexOf(keyValue[3], keyValue[1].length + keyValue[2].length);
    if (character >= valueStart) {
      const { typed, start } = fragmentBefore(current, character);
      return { field: keyValue[2], typed, start };
    }
    return undefined;
  }

  // A key with nothing after it - the cursor sits where the value will go.
  const emptyKey = current.match(EMPTY_KEY_RE);
  if (emptyKey && character >= current.length) {
    return { field: emptyKey[2], typed: '', start: character };
  }

  // `- value` - walk up to the key that owns this sequence.
  const item = current.match(SEQ_ITEM_RE);
  if (item) {
    const itemIndent = item[1].length;
    for (let i = line - 1; i >= 0; i--) {
      const candidate = lines[i];
      if (!candidate.trim() || candidate.trim().startsWith('#')) continue;
      const owner = candidate.match(EMPTY_KEY_RE);
      if (owner && owner[1].length <= itemIndent && !candidate.trim().startsWith('- ')) {
        const { typed, start } = fragmentBefore(current, character);
        return { field: owner[2], typed, start };
      }
      // A shallower line that is not our owning key means the sequence ended before we found one.
      if (indentOf(candidate) < itemIndent && !candidate.trim().startsWith('- ')) return undefined;
    }
  }

  return undefined;
}

/** The id prefixes a field accepts, or undefined when the field holds no reference. */
export function prefixesForField(field: string): readonly string[] | undefined {
  return ID_FIELD_PREFIXES[field];
}

/** `orders.CMD001` -> `CMD`; `MIG003` -> `MIG`. Undefined when the id is not prefix-shaped. */
export function prefixOf(id: string): string | undefined {
  const bare = id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id;
  return bare.match(/^([A-Za-z]{1,6})\d{2,5}$/)?.[1];
}

/** A completion row, in the shape the vscode layer turns into a CompletionItem. */
export interface IdCompletion {
  id: string;
  name: string;
  kind: string;
  file: string;
  /**
   * What the editor's fuzzy matcher sees. The NAME leads, so typing `subm` is a prefix match
   * against `Submit Order ...` and scores at the top; the id trails so `orders.CMD0` still finds
   * the same row. A label of `orders.CMD001` alone would match neither.
   */
  filterText: string;
  /** Orders by name, so a list read top-to-bottom reads as names rather than numbers. */
  sortText: string;
}

/**
 * The rows to offer for `field`, drawn from every indexed id whose prefix that field accepts.
 *
 * No narrowing by what has been typed: the editor does that itself, and doing it here as well would
 * mean an author who types a name fragment gets nothing, since the fragment matches no id.
 */
export function completionsFor(field: string, entries: Iterable<IdEntry>): IdCompletion[] {
  const accepted = prefixesForField(field);
  if (!accepted?.length) return [];
  const allowed = new Set(accepted);

  const rows: IdCompletion[] = [];
  for (const entry of entries) {
    const prefix = prefixOf(entry.id);
    if (!prefix || !allowed.has(prefix)) continue;
    rows.push({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      file: entry.file,
      filterText: entry.name ? `${entry.name} ${entry.id}` : entry.id,
      sortText: `${entry.name || '￿'}${entry.id}`.toLowerCase(),
    });
  }
  return rows;
}
