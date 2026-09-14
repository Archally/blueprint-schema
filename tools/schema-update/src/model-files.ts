import fs from 'node:fs';
import path from 'node:path';

/**
 * Finding the files a migration module may rewrite.
 *
 * Every module walks the model directory, and they all have to agree on what is IN the model.
 * The one question that is not obvious is what to do with a directory whose name begins with a
 * dot, because a model root holds two unrelated kinds of them:
 *
 *   - `.migrations/` holds change programs. A change program names model entities by their ids, so
 *     it is a model document: when a module renames an id, the reference here has to move with it or
 *     it resolves to nothing. It is read by validation and it becomes nodes in the model graph.
 *   - `.quality/`, `.audit/` and `.specs/` hold tooling - scripts, reports, notes. Nothing in them
 *     is addressed by an id and nothing reads them as part of the model.
 *
 * So the rule is: a dot-directory is skipped unless it is named below. Adding one is a deliberate
 * statement that it holds model documents.
 */
const MODEL_DOT_DIRECTORIES: ReadonlySet<string> = new Set(['.migrations']);

const YAML_FILE = /\.(yaml|yml)$/i;
const PROSE_FILE = /\.(md|markdown)$/i;

/** True for a directory entry the walk descends into. */
function isModelDirectory(name: string): boolean {
  return !name.startsWith('.') || MODEL_DOT_DIRECTORIES.has(name);
}

/**
 * Every file under `root` the chain treats as part of the model, sorted so a run reports its
 * changes in the same order every time.
 */
function walk(root: string): string[] {
  const found: string[] = [];
  const descend = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isModelDirectory(entry.name)) descend(fullPath);
      } else if (!entry.name.startsWith('.')) {
        found.push(fullPath);
      }
    }
  };
  descend(root);
  return found.sort();
}

/** The model's YAML documents. */
export function modelYamlFiles(root: string): string[] {
  return walk(root).filter((file) => YAML_FILE.test(path.basename(file)));
}

/**
 * The model's YAML documents and its prose, split. A module that rewrites a key usually also has
 * something to say about the documentation that names it.
 */
export function modelFiles(root: string): { yaml: string[]; prose: string[] } {
  const all = walk(root);
  return {
    yaml: all.filter((file) => YAML_FILE.test(path.basename(file))),
    prose: all.filter((file) => PROSE_FILE.test(path.basename(file))),
  };
}

/** Exported for the suite that pins the policy. */
export const MODEL_DOT_DIRECTORIES_FOR_TEST = MODEL_DOT_DIRECTORIES;
