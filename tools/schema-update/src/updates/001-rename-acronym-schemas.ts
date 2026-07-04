import fs from 'node:fs';
import path from 'node:path';
import type { SchemaUpdate, PlannedChange, UpdatePlan, UpdateResult } from '../types.js';

const FILE_RENAMES: Array<{ from: RegExp; to: string; label: string }> = [
  { from: /^((?:.*\.)?)org\.(yaml|yml)$/i, to: '$1organization.$2', label: 'org → organization' },
  { from: /^((?:.*\.)?)rg\.(yaml|yml)$/i, to: '$1infrastructure.$2', label: 'rg → infrastructure' },
  { from: /^((?:.*\.)?)ui\.(yaml|yml)$/i, to: '$1interactions.$2', label: 'ui → interactions' },
];

const BLUEPRINT_YAML_KEYS: Record<string, string> = {
  ui: 'interactions',
  org: 'organization',
};

function walkYamlFiles(directory: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(fullPath));
    } else if (/\.(yaml|yml)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function findFilesToRename(blueprintDir: string): PlannedChange[] {
  const changes: PlannedChange[] = [];
  const files = walkYamlFiles(blueprintDir);

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
  const blueprintFiles = walkYamlFiles(blueprintDir).filter(
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

function findDirectoryRename(blueprintDir: string): PlannedChange | null {
  const dirName = path.basename(blueprintDir);
  if (dirName === 'v2.6') {
    const parentDir = path.dirname(blueprintDir);
    return {
      type: 'rename-directory',
      path: dirName,
      detail: `${dirName}/ → v2.7/ (version bump)`,
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

  const dirRename = findDirectoryRename(absoluteDir);
  changes.push(...findFilesToRename(absoluteDir));
  changes.push(...findBlueprintYamlEdits(absoluteDir));
  if (dirRename) changes.push(dirRename);

  if (changes.length === 0) {
    warnings.push('No files matching rg.yaml, ui.yaml, or org.yaml found — model may already be v2.7');
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

  // Apply file renames first
  for (const change of plan.changes.filter((c) => c.type === 'rename-file')) {
    const oldPath = path.join(absoluteDir, change.path);
    const newName = change.detail.split(' → ')[1]!.split(' (')[0]!;
    const newPath = path.join(absoluteDir, newName);
    try {
      fs.renameSync(oldPath, newPath);
    } catch (error) {
      errors.push(`Failed to rename ${change.path}: ${(error as Error).message}`);
    }
  }

  // Apply YAML edits
  for (const change of plan.changes.filter((c) => c.type === 'edit-yaml')) {
    const filePath = path.join(absoluteDir, change.path);
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

  // Apply directory rename last
  const dirChange = plan.changes.find((c) => c.type === 'rename-directory');
  if (dirChange) {
    const parentDir = path.dirname(absoluteDir);
    const newDir = path.join(parentDir, 'v2.7');
    try {
      fs.renameSync(absoluteDir, newDir);
    } catch (error) {
      errors.push(`Failed to rename directory: ${(error as Error).message}`);
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
