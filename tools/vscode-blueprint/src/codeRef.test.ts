import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseCodeRefPath,
  buildCodeRefUrl,
  selectRepoConfig,
  resolveBrowserUrl,
  parseRepositoryConfig,
  scanCodeRefPaths,
} from './codeRef';

test('parseCodeRefPath — unprefixed vs cross-repo, trims', () => {
  assert.deepEqual(parseCodeRefPath('src/models/Order.ts'), { prefix: null, filepath: 'src/models/Order.ts' });
  assert.deepEqual(parseCodeRefPath('acme/orders#src/x.ts'), { prefix: 'acme/orders', filepath: 'src/x.ts' });
  assert.deepEqual(parseCodeRefPath('  src/x.ts  '), { prefix: null, filepath: 'src/x.ts' });
});

test('buildCodeRefUrl — provider patterns + branch default', () => {
  assert.equal(
    buildCodeRefUrl({ url: 'https://github.com/acme/shop', branch: 'main', provider: 'github' }, 'src/a.ts'),
    'https://github.com/acme/shop/blob/main/src/a.ts',
  );
  assert.equal(
    buildCodeRefUrl({ url: 'https://gitlab.com/acme/shop', branch: 'develop', provider: 'gitlab' }, 'src/a.ts'),
    'https://gitlab.com/acme/shop/-/blob/develop/src/a.ts',
  );
  // bitbucket + branch omitted → default 'main'
  assert.equal(
    buildCodeRefUrl({ url: 'https://bitbucket.org/acme/shop', provider: 'bitbucket' }, 'src/a.ts'),
    'https://bitbucket.org/acme/shop/src/main/src/a.ts',
  );
  // x-* custom provider → github pattern
  assert.equal(
    buildCodeRefUrl({ url: 'https://git.acme.com/acme/shop', provider: 'x-gitea' }, 'src/a.ts'),
    'https://git.acme.com/acme/shop/blob/main/src/a.ts',
  );
});

test('buildCodeRefUrl — normalizes url slash + backslash/leading-slash path', () => {
  assert.equal(
    buildCodeRefUrl({ url: 'https://github.com/acme/shop/', provider: 'github' }, '/src\\a.ts'),
    'https://github.com/acme/shop/blob/main/src/a.ts',
  );
});

test('selectRepoConfig — prefix vs default vs missing', () => {
  const set = { repository: { url: 'u1' }, repositories: { 'acme/orders': { url: 'u2' } } };
  assert.equal(selectRepoConfig(null, set)?.url, 'u1');
  assert.equal(selectRepoConfig('acme/orders', set)?.url, 'u2');
  assert.equal(selectRepoConfig('acme/missing', set), undefined);
});

test('resolveBrowserUrl — end to end + unresolvable cases', () => {
  const set = {
    repository: { url: 'https://github.com/acme/shop', branch: 'develop', provider: 'github' },
    repositories: { 'acme/orders': { url: 'https://gitlab.com/acme/orders', provider: 'gitlab' } },
  };
  assert.equal(resolveBrowserUrl('src/a.ts', set), 'https://github.com/acme/shop/blob/develop/src/a.ts');
  assert.equal(resolveBrowserUrl('acme/orders#lib/b.rb', set), 'https://gitlab.com/acme/orders/-/blob/main/lib/b.rb');
  assert.equal(resolveBrowserUrl('acme/unknown#x', set), undefined); // no matching cross-repo config
  assert.equal(resolveBrowserUrl('src/a.ts', {}), undefined); // no config at all
  assert.equal(resolveBrowserUrl('', set), undefined); // empty path
});

test('parseRepositoryConfig — single repository block (prestashop shape)', () => {
  const text = [
    'version: 1.0.0',
    'repository:',
    '  url: "https://github.com/PrestaShop/PrestaShop"',
    '  branch: "develop"',
    '  provider: "github"',
    'layout:',
    '  mode: slices',
  ].join('\n');
  const set = parseRepositoryConfig(text);
  assert.deepEqual(set.repository, {
    url: 'https://github.com/PrestaShop/PrestaShop',
    branch: 'develop',
    provider: 'github',
  });
  assert.equal(set.repositories, undefined);
  // proves the shipped public example lights up:
  assert.equal(
    resolveBrowserUrl('src/Core/Domain/ApiClient/Command/AddApiClientCommand.php', set),
    'https://github.com/PrestaShop/PrestaShop/blob/develop/src/Core/Domain/ApiClient/Command/AddApiClientCommand.php',
  );
});

test('parseRepositoryConfig — repositories map, unquoted values, inline comments, branch default', () => {
  const text = [
    'repository:',
    '  url: https://github.com/acme/shop   # primary',
    '  provider: github',
    'repositories:',
    '  "acme/orders-service":',
    '    url: "https://gitlab.com/acme/orders-service"',
    '    provider: gitlab',
    '  acme/pay:',
    '    url: https://bitbucket.org/acme/pay',
    '    branch: release',
    '    provider: bitbucket',
    'tags: [a, b]',
  ].join('\n');
  const set = parseRepositoryConfig(text);
  assert.deepEqual(set.repository, { url: 'https://github.com/acme/shop', provider: 'github' });
  assert.equal(resolveBrowserUrl('src/x.ts', set), 'https://github.com/acme/shop/blob/main/src/x.ts');
  assert.equal(
    resolveBrowserUrl('acme/orders-service#a.rb', set),
    'https://gitlab.com/acme/orders-service/-/blob/main/a.rb',
  );
  assert.equal(resolveBrowserUrl('acme/pay#p.py', set), 'https://bitbucket.org/acme/pay/src/release/p.py');
});

test('parseRepositoryConfig — no repo config → empty set', () => {
  assert.deepEqual(parseRepositoryConfig('version: 1.0.0\nlayout:\n  mode: unified\n'), {});
});

test('scanCodeRefPaths — block, inline-flow, cross-repo; ignores non-code_refs path/filepath', () => {
  const lines = [
    'domain:',
    '  aggregates:',
    '    - id: AGG001',
    '      name: Order',
    '      code_refs:',
    '        - path: "src/models/Order.ts"',
    '          role: model',
    '        - path: src/api/OrderController.ts   # unquoted + comment',
    '        - { path: "acme/orders#lib/x.rb", role: impl }',
    '      description: "not a code_ref path"',
    '    - id: AGG002',
    '      path: "should-not-match.ts"',           // a `path:` OUTSIDE any code_refs block
    '      code_refs:',
    '        - path: "src/second.ts"',
    'concepts:',
    '  - filepath: "must-not-match.ts"',            // `filepath:` is not `path:`
  ];
  const hits = scanCodeRefPaths(lines.join('\n'));

  // exactly the four real code_ref paths, in order
  assert.deepEqual(
    hits.map((h) => h.raw),
    ['src/models/Order.ts', 'src/api/OrderController.ts', 'acme/orders#lib/x.rb', 'src/second.ts'],
  );
  // every reported range exactly covers its raw path (quotes excluded)
  for (const h of hits) {
    assert.equal(lines[h.line].slice(h.startCh, h.endCh), h.raw);
  }
});

test('scanCodeRefPaths — no code_refs block → no hits', () => {
  assert.deepEqual(scanCodeRefPaths('domain:\n  path: "x.ts"\n  aggregates: []\n'), []);
});
