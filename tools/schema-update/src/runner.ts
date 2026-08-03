import path from 'node:path';
import fs from 'node:fs';
import type { PlannedChange, SchemaUpdate, UpdatePlan, UpdateResult } from './types.js';

import { update as update001 } from './updates/001-rename-acronym-schemas.js';
import { update as update002 } from './updates/002-quality-characteristic-two-level.js';
import { update as update004 } from './updates/004-arch-party-ids.js';

// Version order, single pass — see resolveChain. `004` follows `002`: both are in-place 2.7
// restructures, and a v2.6 model must receive 001 → 002 → 004 in one run.
const ALL_UPDATES: SchemaUpdate[] = [update001, update002, update004];

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

/**
 * Every update that applies to `sourceVersion`, in the order they must run.
 *
 * A model two shape-changes behind needs BOTH, and the old `findUpdate` returned only the
 * first — so a v2.6 model landed on 2.7 and silently stopped, leaving `002` unapplied
 * unless the operator noticed and re-ran. This resolves the whole chain up front.
 *
 * ── Why a single pass and not a loop ──────────────────────────────────────────
 * The obvious implementation — "keep applying while some update matches the current
 * version" — DOES NOT TERMINATE. `002` declares `sourceVersion: '2.7'` and
 * `targetVersion: '2.7'` (an in-place content migration), so it would match itself
 * forever. One pass over `ALL_UPDATES` in declared order means each module is considered
 * exactly once, which terminates by construction regardless of what a future module
 * declares. Register new modules in version order and the chain stays correct.
 */
export function resolveChain(sourceVersion: string): SchemaUpdate[] {
  const chain: SchemaUpdate[] = [];
  let currentVersion = sourceVersion;
  for (const update of ALL_UPDATES) {
    if (update.sourceVersion !== currentVersion) continue;
    chain.push(update);
    currentVersion = update.targetVersion;
  }
  return chain;
}

/**
 * The FIRST update applicable to `sourceVersion`, or null.
 * Prefer {@link resolveChain} — this only ever migrates one hop.
 */
export function findUpdate(sourceVersion: string): SchemaUpdate | null {
  return resolveChain(sourceVersion)[0] ?? null;
}

export function listUpdates(): SchemaUpdate[] {
  return ALL_UPDATES;
}

/**
 * Where the model lives after `update` has been applied to `blueprintDir`.
 *
 * `001` renames the version directory itself (`v2.6/` → `v2.7/`), so a chained second hop
 * MUST run against the new path — pass the original and it operates on a directory that no
 * longer exists. Derived from the result rather than assumed: only a result that actually
 * contains a `rename-directory` change moves the root.
 */
export function directoryAfter(blueprintDir: string, update: SchemaUpdate, changes: PlannedChange[]): string {
  const renamed = changes.some((change) => change.type === 'rename-directory');
  if (!renamed) return blueprintDir;
  return path.join(path.dirname(blueprintDir), `v${update.targetVersion}`);
}

export function planUpdate(blueprintDir: string): UpdatePlan | null {
  const version = detectVersion(blueprintDir);
  if (!version) return null;
  const update = findUpdate(version);
  if (!update) return null;
  return update.plan(blueprintDir);
}

/** One hop of an applied chain: which update ran, what it did, and where the model ended up. */
export interface AppliedHop {
  update: SchemaUpdate;
  result: UpdateResult;
  directoryAfter: string;
}

/**
 * Apply every applicable update in order, following the model if a hop relocates it.
 *
 * Stops at the first hop that reports errors — a partially-migrated tree is recoverable
 * (the completed hops are real, and re-running resumes from the new version), whereas
 * pressing on would apply a later transform to a tree the previous one failed to produce.
 */
export function applyChain(blueprintDir: string): { hops: AppliedHop[]; error?: string; finalDirectory: string } {
  const version = detectVersion(blueprintDir);
  if (!version) {
    return { hops: [], error: `Cannot detect schema version from directory: ${blueprintDir}`, finalDirectory: blueprintDir };
  }
  const chain = resolveChain(version);
  if (chain.length === 0) {
    return {
      hops: [],
      error: `No update available for version ${version}. Available: ${ALL_UPDATES.map((u) => `${u.sourceVersion}→${u.targetVersion}`).join(', ')}`,
      finalDirectory: blueprintDir,
    };
  }

  const hops: AppliedHop[] = [];
  let currentDir = blueprintDir;
  for (const update of chain) {
    const result = update.apply(currentDir);
    const nextDir = directoryAfter(currentDir, update, result.changes);
    hops.push({ update, result, directoryAfter: nextDir });
    if (result.errors.length > 0) {
      return { hops, error: `Stopped at v${update.sourceVersion}→v${update.targetVersion}: ${result.errors.join('; ')}`, finalDirectory: nextDir };
    }
    currentDir = nextDir;
  }
  return { hops, finalDirectory: currentDir };
}

/** Single-hop apply, kept for callers that genuinely want one step. Prefer {@link applyChain}. */
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
