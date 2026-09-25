import path from 'node:path';
import fs from 'node:fs';
import type { PlannedChange, SchemaUpdate, UpdatePlan, UpdateResult } from './types.js';

import { update as update001 } from './updates/001-rename-acronym-schemas.js';
import { update as update002 } from './updates/002-quality-characteristic-two-level.js';
import { update as update004 } from './updates/004-arch-party-ids.js';
import { update as update005 } from './updates/005-v28-typed-ids.js';
import { update as update006 } from './updates/006-retire-single-letter-bands.js';
import { update as update007 } from './updates/007-story-becomes-process.js';
import { update as update008 } from './updates/008-arch-root-contexts.js';
import { update as update009 } from './updates/009-domain-registry.js';
import { update as update010 } from './updates/010-retire-watch-item-band.js';
import { update as update011 } from './updates/011-contract-identity.js';
import { update as update012 } from './updates/012-next-branches.js';
import { update as update013 } from './updates/013-handles-to-inprocess-contract.js';
import { update as update014 } from './updates/014-dispatch-inprocess.js';
import { update as update015 } from './updates/015-dependency-type-to-coupling.js';
import { update as update016 } from './updates/016-bcc-domain-scope.js';

// Version order, single pass — see resolveChain. `004` follows `002`: both are in-place 2.7
// restructures, and a v2.6 model must receive 001 → 002 → 004 in one run. `005` is the only hop off
// 2.7, and it must run AFTER `004`: `004` mints the party ids that `005` requires to be present, and
// `005` reports a party still missing one rather than minting it. `008` is an in-place 2.8
// restructure and runs last: it groups a model's declarations by the `PRT###` `004` minted, and a
// model arriving from 2.7 must reach 2.8 before it applies.
// `007` is an in-place 2.8 rename and runs before `008`: it renames a model's narrative ids and
// its story files, and every 2.8 module after it should see the model in its final vocabulary.
// `006` is the band retirement, and by the ordering both plan files state it runs AFTER `007`:
// the narrative rename walks the same corpus, and the two must not interleave. So it is registered
// between `007` and `008` rather than by its number - the number records when it was specified,
// the position records when it runs.
// `010` retires the seventh band and touches only a watchlist entry's own id, so it shares no
// file region with anything above it and its position is free. It sits last because that is
// when it was specified.
// `011` rewrites a contract's `output:` inside an arch file's `contracts:` block, which no module
// above it touches, so its position is free too. It runs after `008` because `008` moves service
// declarations between the nested and root forms, and this one reads the enclosing keys to decide
// what an `output:` belongs to - a model should reach its final shape before that reading happens.
// `013` relocates a service's `handles:` into its `contracts:` block, so it must run after `008`
// (which moves service declarations between the nested and root forms) and after `011` (which
// rewrites `output:` inside the same block). It reads the enclosing keys to decide where the new
// container goes, and a model should reach its final shape before that reading happens.
// `014` rewrites one value on an operation, so it shares no file region with anything above it and
// its position is free. It sits last because that is when it was specified.
// `015` rewrites a key and its value inside a context's `dependencies:` list. `008` moves service
// declarations between the nested and root forms and leaves `dependencies:` on the context either
// way, so the two share no region - but it runs after `008` regardless, on the same principle as
// `011` and `013`: this module reads the enclosing keys to decide which `type:` is a dependency's,
// and a model should reach its final shape before that reading happens.
// `016` renames one key inside a document's root `business_decisions:`, `assumptions:` and `kpis:`
// collections. No module above it writes into any of the three, so it shares no file region with
// them and its position is free. It sits last because that is when it was specified.
const ALL_UPDATES: SchemaUpdate[] = [update001, update002, update004, update005, update007, update006, update008, update009, update010, update011, update012, update013, update014, update015, update016];

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
 * `001` copies the model into the next version directory (`v2.6/` → `v2.7/`) and leaves the
 * source line in place, so a chained second hop MUST run against the new path - pass the
 * original and it re-applies the hop to a tree that is deliberately staying where it is.
 * Derived from the result rather than assumed: only a result that actually contains a
 * `copy-directory` change moves the root.
 */
export function directoryAfter(blueprintDir: string, update: SchemaUpdate, changes: PlannedChange[]): string {
  const copied = changes.some((change) => change.type === 'copy-directory');
  if (!copied) return blueprintDir;
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
