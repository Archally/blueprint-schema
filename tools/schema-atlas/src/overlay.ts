/**
 * Overlay loading + guard (DEC-ATL-08, DEC-ATL-17, VAL-ATL-006).
 *
 * Overlays are narrowly-scoped, non-authoritative, provenance-bearing inputs that
 * add human semantics the schema cannot safely express on its own. They may NEVER
 * override validation truth (types, requiredness, enums, patterns, relationships).
 * The loader enforces both the allowed-category list and the forbidden-key guard;
 * a violation is a hard failure, not a warning.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Overlay, OverlayCategory, OverlayEntry } from './types.js';
import { walkFiles, loadYaml, toPosixPath } from './schema-io.js';
import type { PolicyReporter } from './policy.js';

const ALLOWED_CATEGORIES: ReadonlySet<OverlayCategory> = new Set<OverlayCategory>([
  'explanatory-note',
  'modeling-guidance',
  'migration-note',
  'changelog-rationale',
  'curated-example',
  'rename-annotation',
]);

/** Keys that would let an overlay redefine validation truth — forbidden anywhere in an entry. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'type',
  'required',
  'enum',
  'properties',
  'pattern',
  'additionalProperties',
  '$ref',
  'oneOf',
  'anyOf',
  'allOf',
  'const',
]);

const ALLOWED_ENTRY_KEYS: ReadonlySet<string> = new Set([
  'category',
  'target',
  'note',
  'example',
  'renamedFrom',
]);

export class OverlayError extends Error {}

function validateEntry(overlayId: string, index: number, raw: unknown): OverlayEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new OverlayError(`${overlayId}: entry ${index} is not an object`);
  }
  const entry = raw as Record<string, unknown>;

  for (const key of Object.keys(entry)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new OverlayError(
        `${overlayId}: entry ${index} uses forbidden key "${key}" — overlays may not override validation truth (DEC-ATL-17).`,
      );
    }
    if (!ALLOWED_ENTRY_KEYS.has(key)) {
      throw new OverlayError(`${overlayId}: entry ${index} has unknown key "${key}".`);
    }
  }

  const category = entry['category'];
  if (typeof category !== 'string' || !ALLOWED_CATEGORIES.has(category as OverlayCategory)) {
    throw new OverlayError(
      `${overlayId}: entry ${index} has invalid category "${String(category)}". Allowed: ${[...ALLOWED_CATEGORIES].join(', ')}.`,
    );
  }
  const target = entry['target'];
  if (typeof target !== 'string' || target.length === 0) {
    throw new OverlayError(`${overlayId}: entry ${index} is missing a string "target".`);
  }
  if (category === 'curated-example' && typeof entry['example'] !== 'string') {
    throw new OverlayError(`${overlayId}: entry ${index} (curated-example) requires an "example" string.`);
  }
  if (category === 'rename-annotation' && typeof entry['renamedFrom'] !== 'string') {
    throw new OverlayError(`${overlayId}: entry ${index} (rename-annotation) requires a "renamedFrom" string.`);
  }

  return {
    category: category as OverlayCategory,
    target,
    note: typeof entry['note'] === 'string' ? (entry['note'] as string).trim() : undefined,
    example: typeof entry['example'] === 'string' ? entry['example'] : undefined,
    renamedFrom: typeof entry['renamedFrom'] === 'string' ? entry['renamedFrom'] : undefined,
  };
}

function validateOverlay(relPath: string, raw: unknown): Overlay {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new OverlayError(`${relPath}: overlay did not parse to an object`);
  }
  const doc = raw as Record<string, unknown>;
  const id = typeof doc['id'] === 'string' ? (doc['id'] as string) : relPath;
  const entriesRaw = doc['entries'];
  const entries: OverlayEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    entriesRaw.forEach((e, i) => entries.push(validateEntry(id, i, e)));
  }
  return {
    id,
    description: typeof doc['description'] === 'string' ? (doc['description'] as string) : undefined,
    entries,
  };
}

/**
 * Load every `*.overlay.yaml` under `overlaysDir` whose filename targets the given
 * version (either `<version>.overlay.yaml` or a shared `*.overlay.yaml`). Hard-fails
 * on any guard violation via `policy.fail` + throw.
 */
export function loadOverlays(
  overlaysDir: string | undefined,
  version: string,
  policy: PolicyReporter,
): Overlay[] {
  if (!overlaysDir || !fs.existsSync(overlaysDir)) {
    policy.skip('overlays-absent', `No overlay directory (${overlaysDir ?? 'unset'}); generating from schema only.`);
    return [];
  }
  const files = walkFiles(overlaysDir, (f) => /\.overlay\.ya?ml$/i.test(f));
  const overlays: Overlay[] = [];
  for (const abs of files) {
    const rel = toPosixPath(path.relative(overlaysDir, abs));
    const base = path.basename(abs).toLowerCase();
    // Version-scoped overlays only apply to their version; shared overlays apply to all.
    const versioned = /^v\d+\.\d+/.test(base);
    if (versioned && !base.startsWith(version.toLowerCase())) continue;
    try {
      overlays.push(validateOverlay(rel, loadYaml(abs)));
    } catch (err) {
      if (err instanceof OverlayError) {
        policy.fail('overlay-invalid', err.message);
        throw err;
      }
      throw err;
    }
  }
  return overlays;
}

/** Index overlay entries by their target address for fast lookup during generation. */
export function indexOverlays(overlays: Overlay[]): Map<string, { entry: OverlayEntry; overlayId: string }[]> {
  const idx = new Map<string, { entry: OverlayEntry; overlayId: string }[]>();
  for (const overlay of overlays) {
    for (const entry of overlay.entries) {
      const list = idx.get(entry.target) ?? [];
      list.push({ entry, overlayId: overlay.id });
      idx.set(entry.target, list);
    }
  }
  return idx;
}
