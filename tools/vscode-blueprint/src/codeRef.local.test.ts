import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';
import { resolveLocalPath, resolveCodeRefTarget, type RepoConfigSet } from './codeRef';

// Local-clone resolution (step-02): resolveLocalPath is pure string joining; resolveCodeRefTarget adds the
// D2 behavior × existence decision, with existence INJECTED so the matrix is deterministically testable.

const SET: RepoConfigSet = {
  repository: { url: 'https://github.com/acme/shop', branch: 'main', provider: 'github' },
  repositories: { 'acme/orders': { url: 'https://gitlab.com/acme/orders', provider: 'gitlab' } },
};

// ── resolveLocalPath — url key, prefix alias, tolerance, normalization, misses ────────────────────

test('resolveLocalPath — unprefixed ref keyed by repository.url', () => {
  const roots = { 'https://github.com/acme/shop': 'C:/code/shop' };
  assert.equal(resolveLocalPath('src/models/Order.ts', SET, roots), 'C:/code/shop/src/models/Order.ts');
});

test('resolveLocalPath — cross-repo ref keyed by repositories[prefix].url', () => {
  const roots = { 'https://gitlab.com/acme/orders': '/home/me/orders' };
  assert.equal(resolveLocalPath('acme/orders#lib/x.rb', SET, roots), '/home/me/orders/lib/x.rb');
});

test('resolveLocalPath — org/repo prefix accepted as an alias key (D5)', () => {
  const roots = { 'acme/orders': '/home/me/orders' };
  assert.equal(resolveLocalPath('acme/orders#lib/x.rb', SET, roots), '/home/me/orders/lib/x.rb');
});

test('resolveLocalPath — prefix alias resolves even with no repository config', () => {
  const roots = { 'acme/orders': '/home/me/orders' };
  assert.equal(resolveLocalPath('acme/orders#lib/x.rb', {}, roots), '/home/me/orders/lib/x.rb');
});

test('resolveLocalPath — url key tolerates a trailing-slash mismatch', () => {
  // config url carries a trailing slash; the localRoots key does not → still resolves
  const roots = { 'https://github.com/acme/shop': 'C:/code/shop' };
  assert.equal(
    resolveLocalPath('src/a.ts', { repository: { url: 'https://github.com/acme/shop/' } }, roots),
    'C:/code/shop/src/a.ts',
  );
});

test('resolveLocalPath — normalizes backslashes, leading slash, and a trailing-slash root', () => {
  const roots = { 'https://github.com/acme/shop': 'C:\\code\\shop\\' };
  assert.equal(resolveLocalPath('/src\\models\\Order.ts', SET, roots), 'C:/code/shop/src/models/Order.ts');
});

test('resolveLocalPath — unmapped / no-config / unknown-prefix / empty path → undefined', () => {
  assert.equal(resolveLocalPath('src/a.ts', SET, {}), undefined); // no mapping
  assert.equal(resolveLocalPath('src/a.ts', {}, {}), undefined); // no repo config + no mapping
  assert.equal(resolveLocalPath('acme/unknown#x', SET, { 'acme/orders': '/x' }), undefined); // prefix not mapped
  assert.equal(resolveLocalPath('', SET, { 'https://github.com/acme/shop': 'C:/x' }), undefined); // empty path
});

// ── resolveCodeRefTarget — behavior × existence matrix, existence via a REAL temp dir ─────────────

const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'archally-coderef-'));
fs.mkdirSync(nodePath.join(tmpRoot, 'src', 'models'), { recursive: true });
fs.writeFileSync(nodePath.join(tmpRoot, 'src', 'models', 'Order.ts'), '// present');
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// Real fs-backed existence predicate — the same contract the extension supplies via vscode.workspace.fs.stat.
const exists = async (absPath: string): Promise<boolean> => {
  try {
    return (await fsp.stat(absPath)).isFile();
  } catch {
    return false;
  }
};

const rootsToTmp = { 'https://github.com/acme/shop': tmpRoot };
const PRESENT = 'src/models/Order.ts'; // exists under tmpRoot
const MISSING = 'src/models/Ghost.ts'; // mapped repo, but no such file on disk
const HOST_URL_MISSING = 'https://github.com/acme/shop/blob/main/src/models/Ghost.ts';

test('resolveCodeRefTarget — localThenBrowser + mapped + exists → local file', async () => {
  const target = await resolveCodeRefTarget(PRESENT, SET, rootsToTmp, 'localThenBrowser', exists);
  assert.equal(target?.kind, 'file');
  assert.equal(await exists(target!.value), true); // the chosen path is a real file
});

test('resolveCodeRefTarget — localThenBrowser + mapped + missing → browser URL', async () => {
  const target = await resolveCodeRefTarget(MISSING, SET, rootsToTmp, 'localThenBrowser', exists);
  assert.deepEqual(target, { kind: 'url', value: HOST_URL_MISSING });
});

test('resolveCodeRefTarget — localThenBrowser + unmapped → browser URL', async () => {
  const target = await resolveCodeRefTarget(PRESENT, SET, {}, 'localThenBrowser', exists);
  assert.equal(target?.kind, 'url');
});

test('resolveCodeRefTarget — browser → always URL even when the local file exists', async () => {
  const target = await resolveCodeRefTarget(PRESENT, SET, rootsToTmp, 'browser', exists);
  assert.equal(target?.kind, 'url');
});

test('resolveCodeRefTarget — local + exists → file; local + missing → none (no fallback)', async () => {
  assert.equal((await resolveCodeRefTarget(PRESENT, SET, rootsToTmp, 'local', exists))?.kind, 'file');
  assert.equal(await resolveCodeRefTarget(MISSING, SET, rootsToTmp, 'local', exists), undefined);
});

test('resolveCodeRefTarget — unresolvable (no config, no mapping) → undefined for every behavior', async () => {
  for (const behavior of ['localThenBrowser', 'browser', 'local'] as const) {
    assert.equal(await resolveCodeRefTarget('src/a.ts', {}, {}, behavior, exists), undefined);
  }
});
