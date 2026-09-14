import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';
import { modelYamlFiles } from '../model-files.js';

const FILE_RENAMES: Array<{ from: RegExp; to: string; label: string }> = [
  { from: /^((?:.*\.)?)org\.(yaml|yml)$/i, to: '$1organization.$2', label: 'org → organization' },
  { from: /^((?:.*\.)?)rg\.(yaml|yml)$/i, to: '$1infrastructure.$2', label: 'rg → infrastructure' },
  { from: /^((?:.*\.)?)ui\.(yaml|yml)$/i, to: '$1interactions.$2', label: 'ui → interactions' },
];

const BLUEPRINT_YAML_KEYS: Record<string, string> = {
  ui: 'interactions',
  org: 'organization',
};

/** What a model that has been through this hop declares it is written against. */
const TARGET_SCHEMA_VERSION = '2.7.0';
/** A `schemaVersion:` line at the document root, with or without quotes and a trailing comment. */
const SCHEMA_VERSION_LINE = /^schemaVersion:[ \t]*["']?(\d+\.\d+\.\d+)["']?[ \t]*(#.*)?$/m;
const SCHEMA_VERSION_REWRITE = /^(schemaVersion:[ \t]*["']?)(\d+\.\d+\.\d+)(["']?)/m;
/** Marks the changes this hop applies as a version bump rather than as an acronym rename. */
const VERSION_DETAIL = 'schemaVersion';

function findFilesToRename(blueprintDir: string): PlannedChange[] {
  const changes: PlannedChange[] = [];
  const files = modelYamlFiles(blueprintDir);

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    for (const rule of FILE_RENAMES) {
      if (rule.from.test(fileName)) {
        const newName = fileName.replace(rule.from, rule.to);
        const newPath = path.join(path.dirname(filePath), newName);
        const relativePath = path.relative(blueprintDir, filePath);
        const relativeNewPath = path.relative(blueprintDir, newPath);
        changes.push({
          type: 'rename-file',
          path: relativePath,
          detail: `${relativePath} → ${relativeNewPath} (${rule.label})`,
        });
        break;
      }
    }
  }

  return changes;
}

function findBlueprintYamlEdits(blueprintDir: string): PlannedChange[] {
  const changes: PlannedChange[] = [];
  const blueprintFiles = modelYamlFiles(blueprintDir).filter(
    (f) => path.basename(f) === 'blueprint.yaml' || path.basename(f) === 'blueprint.yml'
  );

  for (const filePath of blueprintFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(blueprintDir, filePath);

    for (const [oldKey, newKey] of Object.entries(BLUEPRINT_YAML_KEYS)) {
      const keyPattern = new RegExp(`^(\\s+)${oldKey}:`, 'gm');
      if (keyPattern.test(content)) {
        changes.push({
          type: 'edit-yaml',
          path: relativePath,
          detail: `Property key '${oldKey}' → '${newKey}'`,
        });
      }
    }

    // NOTE: additive 2.7 fields (e.g. operation `dispatch`, roadmap work-items, the `json-rpc`
    // protocol) require NO migration — they are optional, so pre-2.7 documents validate against 2.7
    // unchanged. Only the acronym file/key renames are structural. Flag path references to renamed files.
    if (content.includes('rg.yaml') || content.includes('ui.yaml') || content.includes('org.yaml')) {
      changes.push({
        type: 'edit-yaml',
        path: relativePath,
        detail: 'Update file path references (rg.yaml→infrastructure.yaml, ui.yaml→interactions.yaml, org.yaml→organization.yaml)',
      });
    }
  }

  return changes;
}

/**
 * Every file whose `schemaVersion` still names the version this hop migrates AWAY from.
 *
 * The directory a model sits in and the version it declares are two different statements, and only
 * the second travels with the file. Leaving it behind produces a `v2.7/` tree whose documents say
 * they are 2.6 - which `bp validate` reports, correctly, as a disagreement between the model and
 * the schema it was loaded against.
 */
function findSchemaVersionEdits(blueprintDir: string): PlannedChange[] {
  const changes: PlannedChange[] = [];
  for (const filePath of modelYamlFiles(blueprintDir)) {
    const match = SCHEMA_VERSION_LINE.exec(fs.readFileSync(filePath, 'utf8'));
    if (!match || match[1] === TARGET_SCHEMA_VERSION) continue;
    changes.push({
      type: 'edit-yaml',
      path: path.relative(blueprintDir, filePath),
      detail: `${VERSION_DETAIL} ${match[1]} -> ${TARGET_SCHEMA_VERSION}`,
    });
  }
  return changes;
}

function findDirectoryCopy(blueprintDir: string): PlannedChange | null {
  const dirName = path.basename(blueprintDir);
  if (dirName === 'v2.6') {
    return {
      type: 'copy-directory',
      path: dirName,
      detail: `${dirName}/ → v2.7/ (version bump; ${dirName}/ is kept)`,
    };
  }
  return null;
}

function buildPlan(blueprintDir: string): UpdatePlan {
  const absoluteDir = path.resolve(blueprintDir);
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(absoluteDir)) {
    return { sourceVersion: '2.6', targetVersion: '2.7', description: update.description, changes: [], warnings: [`Directory not found: ${absoluteDir}`] };
  }

  const dirRename = findDirectoryCopy(absoluteDir);
  changes.push(...findFilesToRename(absoluteDir));
  changes.push(...findBlueprintYamlEdits(absoluteDir));
  changes.push(...findSchemaVersionEdits(absoluteDir));
  if (dirRename) changes.push(dirRename);

  if (changes.length === 0) {
    warnings.push('No acronym files and no schemaVersion below 2.7.0 — the model is already v2.7');
  }

  return {
    sourceVersion: '2.6',
    targetVersion: '2.7',
    description: update.description,
    changes,
    warnings,
  };
}

function applyPlan(blueprintDir: string): UpdateResult {
  const plan = buildPlan(blueprintDir);
  const absoluteDir = path.resolve(blueprintDir);
  const errors: string[] = [];

  if (plan.warnings.length > 0 && plan.changes.length === 0) {
    return { ...plan, applied: false, errors: [] };
  }

  // THE SOURCE VERSION LINE IS KEPT. The pristine tree is copied into the next version
  // directory BEFORE anything is edited, and every edit below addresses the copy, so `v2.6/`
  // survives the hop exactly as it was. Copying first rather than migrating in place and copying
  // after has a second property worth more than the first: a run that fails halfway leaves the
  // source untouched instead of half-migrated, so the remedy is to delete the partial copy.
  const targetDir = path.join(path.dirname(absoluteDir), 'v2.7');
  const copies = plan.changes.some((c) => c.type === 'copy-directory');
  const workDir = copies ? targetDir : absoluteDir;
  if (copies) {
    if (fs.existsSync(targetDir)) {
      return {
        ...plan,
        applied: false,
        errors: [`${path.basename(targetDir)}/ already exists beside the model - move it aside before migrating.`],
      };
    }
    try {
      fs.cpSync(absoluteDir, targetDir, { recursive: true });
    } catch (error) {
      return { ...plan, applied: false, errors: [`Failed to copy the model to ${path.basename(targetDir)}/: ${(error as Error).message}`] };
    }
  }

  // Say 2.7 in the documents, not only in the directory name. Read-modify-write on the whole file
  // so every other byte - key order, comments, line endings - survives untouched.
  //
  // BEFORE the renames, because a change's `path` is the name the file had when the plan was built.
  // Bumping afterwards looks for `orders/rg.yaml` in a tree where it is now `orders/infrastructure.yaml`,
  // and the hop fails on a file it had just moved itself.
  for (const change of plan.changes.filter((c) => c.type === 'edit-yaml' && c.detail.startsWith(VERSION_DETAIL))) {
    const filePath = path.join(workDir, change.path);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      fs.writeFileSync(
        filePath,
        content.replace(SCHEMA_VERSION_REWRITE, (_m, lead: string, _from: string, close: string) => `${lead}${TARGET_SCHEMA_VERSION}${close}`),
        'utf8',
      );
    } catch (error) {
      errors.push(`Failed to bump schemaVersion in ${change.path}: ${(error as Error).message}`);
    }
  }

  // Apply file renames
  for (const change of plan.changes.filter((c) => c.type === 'rename-file')) {
    const oldPath = path.join(workDir, change.path);
    const newName = change.detail.split(' → ')[1]!.split(' (')[0]!;
    const newPath = path.join(workDir, newName);
    try {
      fs.renameSync(oldPath, newPath);
    } catch (error) {
      errors.push(`Failed to rename ${change.path}: ${(error as Error).message}`);
    }
  }

  // Apply the acronym key and path-reference edits. Version bumps are a separate pass below, so a
  // file that only needs its version rewritten is not run through six replacements that cannot match.
  for (const change of plan.changes.filter((c) => c.type === 'edit-yaml' && !c.detail.startsWith(VERSION_DETAIL))) {
    const filePath = path.join(workDir, change.path);
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      for (const [oldKey, newKey] of Object.entries(BLUEPRINT_YAML_KEYS)) {
        content = content.replace(new RegExp(`^(\\s+)${oldKey}:`, 'gm'), `$1${newKey}:`);
      }
      content = content.replace(/\brg\.yaml\b/g, 'infrastructure.yaml');
      content = content.replace(/\brg\.yml\b/g, 'infrastructure.yml');
      content = content.replace(/\bui\.yaml\b/g, 'interactions.yaml');
      content = content.replace(/\bui\.yml\b/g, 'interactions.yml');
      content = content.replace(/\borg\.yaml\b/g, 'organization.yaml');
      content = content.replace(/\borg\.yml\b/g, 'organization.yml');
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      errors.push(`Failed to edit ${change.path}: ${(error as Error).message}`);
    }
  }

  return { ...plan, applied: errors.length === 0, errors };
}

export const update: SchemaUpdate = {
  sourceVersion: '2.6',
  targetVersion: '2.7',
  description: 'Rename acronym schema files to full descriptive names: rg→infrastructure, ui→interactions, org→organization',
  plan: buildPlan,
  apply: applyPlan,
};
