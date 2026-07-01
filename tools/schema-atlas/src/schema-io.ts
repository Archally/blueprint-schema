/**
 * Filesystem + YAML IO for reading versioned JSON Schema bundles.
 *
 * Mirrors the loading approach the validator uses (`tools/validator/src`), kept
 * local so the Atlas tool depends only on schema files + the `yaml` package —
 * not on any blueprint-instance tooling (DEC-ATL-11, tool placement by
 * responsibility, not folder proximity).
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { PlaneId } from './types.js';

export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

/** Recursively collect files under `dir` matching `include`, sorted for determinism. */
export function walkFiles(dir: string, include: (f: string) => boolean): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (include(full)) out.push(full);
    }
  }
  return out.sort();
}

export function loadYaml(filePath: string): unknown {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Resolve the schema directory for a version. Accepts either the version root
 * (which may contain a nested `schema/` dir — the layout `exports` in package.json
 * implies) or the schema dir directly.
 */
export function resolveSchemaDir(versionRoot: string): string {
  const nested = path.join(versionRoot, 'schema');
  return fs.existsSync(nested) && fs.statSync(nested).isDirectory() ? nested : versionRoot;
}

export interface LoadedSchema {
  /** POSIX relPath from the schema dir, e.g. `design/domain.schema.yaml`. */
  relPath: string;
  absPath: string;
  doc: Record<string, unknown>;
}

/** Load every `*.schema.yaml` under a version's schema dir. */
export function loadSchemaVersion(schemaDir: string): LoadedSchema[] {
  if (!fs.existsSync(schemaDir)) {
    throw new Error(`Schema directory not found: ${schemaDir}`);
  }
  const files = walkFiles(schemaDir, (f) => /\.schema\.(ya?ml)$/i.test(f));
  const out: LoadedSchema[] = [];
  for (const absPath of files) {
    const relPath = toPosixPath(path.relative(schemaDir, absPath));
    let doc: unknown;
    try {
      doc = loadYaml(absPath);
    } catch (err) {
      throw new Error(`Failed to parse schema file ${relPath}: ${(err as Error).message}`);
    }
    if (doc === null || typeof doc !== 'object') {
      throw new Error(`Schema file ${relPath} did not parse to an object`);
    }
    out.push({ relPath, absPath, doc: doc as Record<string, unknown> });
  }
  return out;
}

/** Classify a schema file's plane from its relPath. Root files are cross-cutting. */
export function planeOf(relPath: string): PlaneId {
  if (relPath.startsWith('design/')) return 'design';
  if (relPath.startsWith('governance/')) return 'governance';
  return 'cross-cutting';
}
