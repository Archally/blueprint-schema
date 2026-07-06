import path from 'node:path';
import fs from 'node:fs';
import type { SchemaUpdate, UpdatePlan } from './types.js';

import { update as update001 } from './updates/001-rename-acronym-schemas.js';
import { update as update002 } from './updates/002-quality-characteristic-two-level.js';

const ALL_UPDATES: SchemaUpdate[] = [update001, update002];

export function detectVersion(blueprintDir: string): string | null {
  const dirName = path.basename(path.resolve(blueprintDir));
  const versionMatch = dirName.match(/^v(\d+\.\d+)$/);
  if (versionMatch) return versionMatch[1]!;

  const blueprintYaml = path.join(blueprintDir, 'blueprint.yaml');
  if (fs.existsSync(blueprintYaml)) {
    const content = fs.readFileSync(blueprintYaml, 'utf8');
    const versionLine = content.match(/^version:\s*["']?(\d+\.\d+)/m);
    if (versionLine) return versionLine[1]!;
  }

  return null;
}

export function findUpdate(sourceVersion: string): SchemaUpdate | null {
  return ALL_UPDATES.find((u) => u.sourceVersion === sourceVersion) ?? null;
}

export function listUpdates(): SchemaUpdate[] {
  return ALL_UPDATES;
}

export function planUpdate(blueprintDir: string): UpdatePlan | null {
  const version = detectVersion(blueprintDir);
  if (!version) return null;
  const update = findUpdate(version);
  if (!update) return null;
  return update.plan(blueprintDir);
}

export function applyUpdate(blueprintDir: string) {
  const version = detectVersion(blueprintDir);
  if (!version) {
    return { error: `Cannot detect schema version from directory: ${blueprintDir}` };
  }
  const update = findUpdate(version);
  if (!update) {
    return { error: `No update available for version ${version}. Available: ${ALL_UPDATES.map((u) => `${u.sourceVersion}→${u.targetVersion}`).join(', ')}` };
  }
  return update.apply(blueprintDir);
}
