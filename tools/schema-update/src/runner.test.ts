import { describe, it, expect } from 'vitest';
import { resolveChain, findUpdate, listUpdates, directoryAfter } from './runner.js';
import type { PlannedChange, SchemaUpdate } from './types.js';

// Update chains include self-targeting modules and carry renamed directories to the next update.

describe('resolveChain', () => {
  it('returns every applicable update in order, not just the first', () => {
    // Each update follows a compatible predecessor, including self-targeting updates.
    const chain = resolveChain('2.6');
    expect(chain.length).toBeGreaterThan(1);
    expect(chain[0]!.sourceVersion).toBe('2.6');
    for (let index = 1; index < chain.length; index += 1) {
      expect(chain[index]!.sourceVersion).toBe(chain[index - 1]!.targetVersion);
    }
  });

  it('carries a v2.6 model all the way to the head version in one run', () => {
    // The chain's reach, which is the property an operator actually depends on: one invocation,
    // not one hop per release with a human deciding when to run the next.
    const head = listUpdates()[listUpdates().length - 1]!.targetVersion;
    expect(resolveChain('2.6').at(-1)!.targetVersion).toBe(head);
  });

  it('picks up every in-place update when already on 2.7', () => {
    // Every registered 2.7 -> 2.7 module, named by the registry rather than counted by hand.
    const inPlace = listUpdates().filter((u) => u.sourceVersion === '2.7' && u.targetVersion === '2.7');
    const chain = resolveChain('2.7');
    expect(inPlace.length).toBeGreaterThan(0);
    for (const update of inPlace) expect(chain).toContain(update);
  });

  it('returns empty for a version nothing targets', () => {
    expect(resolveChain('1.0')).toEqual([]);
  });

  it('TERMINATES on self-targeting updates (002 and 004 are both 2.7 -> 2.7)', () => {
    // Single-pass semantics execute every self-targeting module exactly once.
    const chain = resolveChain('2.7');
    const selfTargeting = chain.filter((u) => u.sourceVersion === u.targetVersion);
    expect(selfTargeting.length).toBeGreaterThan(1);
    for (const update of new Set(selfTargeting)) {
      expect(selfTargeting.filter((candidate) => candidate === update)).toHaveLength(1);
    }
  });

  it('never yields the same module twice', () => {
    const chain = resolveChain('2.6');
    expect(new Set(chain).size).toBe(chain.length);
  });
});

describe('findUpdate', () => {
  it('still returns a single hop, and it is the head of the chain', () => {
    expect(findUpdate('2.6')).toBe(resolveChain('2.6')[0]);
    expect(findUpdate('9.9')).toBeNull();
  });
});

describe('directoryAfter', () => {
  const fakeUpdate = { sourceVersion: '2.6', targetVersion: '2.7' } as SchemaUpdate;

  it('follows the model when a hop copies it into the next version directory', () => {
    // 001 renames v2.6/ -> v2.7/. Passing the ORIGINAL path to hop 2 would point at a
    // directory that no longer exists.
    const changes: PlannedChange[] = [{ type: 'copy-directory', path: 'v2.6', detail: 'v2.6/ -> v2.7/' }];
    expect(directoryAfter('/models/.blueprint/v2.6', fakeUpdate, changes).replace(/\\/g, '/')).toBe(
      '/models/.blueprint/v2.7',
    );
  });

  it('stays put when the hop only edits contents', () => {
    const changes: PlannedChange[] = [{ type: 'edit-yaml', path: 'quality.yaml', detail: 'restructure' }];
    expect(directoryAfter('/models/.blueprint/v2.7', fakeUpdate, changes)).toBe('/models/.blueprint/v2.7');
  });
});

describe('registry invariants', () => {
  it('modules are declared in version order so a single pass resolves the full chain', () => {
    // resolveChain makes ONE pass. If a future module were registered out of order, the pass
    // would skip it. This asserts the ordering the algorithm depends on.
    const updates = listUpdates();
    let current = updates[0]!.sourceVersion;
    for (const update of updates) {
      expect(update.sourceVersion).toBe(current);
      current = update.targetVersion;
    }
  });
});
