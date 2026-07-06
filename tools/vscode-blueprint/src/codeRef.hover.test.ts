import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { codeRefEntryMeta, buildCodeRefHover } from './codeRef';

// ── codeRefEntryMeta — read role/description of the entry that owns a `path:` line ────────────────

test('codeRefEntryMeta — block entry: role + description, no bleed into the next item', () => {
  const lines = [
    'domain:',
    '  aggregates:',
    '    - id: AGG001',
    '      code_refs:',
    '        - path: "src/models/Order.ts"', // line 4
    '          role: model',
    '          description: "Order aggregate root"',
    '        - path: "src/api/OrderController.ts"', // line 7
    '          role: controller',
  ].join('\n');
  assert.deepEqual(codeRefEntryMeta(lines, 4), { role: 'model', description: 'Order aggregate root' });
  assert.deepEqual(codeRefEntryMeta(lines, 7), { role: 'controller' }); // no description; not "model"
});

test('codeRefEntryMeta — inline-flow entry', () => {
  const text = '        - { path: "acme/orders#lib/x.rb", role: impl, description: "port" }';
  assert.deepEqual(codeRefEntryMeta(text, 0), { role: 'impl', description: 'port' });
});

test('codeRefEntryMeta — path with no siblings → empty', () => {
  const text = ['      code_refs:', '        - path: "src/only.ts"'].join('\n');
  assert.deepEqual(codeRefEntryMeta(text, 1), {});
});

test('codeRefEntryMeta — folded description scalar takes the next line', () => {
  const text = [
    '        - path: "src/x.ts"',
    '          role: model',
    '          description: >',
    '            the long description text',
  ].join('\n');
  assert.deepEqual(codeRefEntryMeta(text, 0), { role: 'model', description: 'the long description text' });
});

// ── buildCodeRefHover — destination + role/description, and the unresolved hint ───────────────────

test('buildCodeRefHover — local file target, with role + host alternate', () => {
  const md = buildCodeRefHover({
    rawPath: 'src/a.ts',
    behavior: 'localThenBrowser',
    role: 'model',
    target: { kind: 'file', value: 'C:/code/shop/src/a.ts' },
    hostAlternate: 'https://github.com/acme/shop/blob/main/src/a.ts',
  });
  assert.match(md, /\*\*code_ref\*\* `src\/a\.ts` · _model_/);
  assert.match(md, /📂 Opens local file — `C:\/code\/shop\/src\/a\.ts`/);
  assert.match(md, /🌐 Also on host — \[https:\/\/github\.com\/acme\/shop\/blob\/main\/src\/a\.ts\]/);
});

test('buildCodeRefHover — host URL target renders a markdown link', () => {
  const md = buildCodeRefHover({
    rawPath: 'src/a.ts',
    behavior: 'localThenBrowser',
    target: { kind: 'url', value: 'https://github.com/acme/shop/blob/main/src/a.ts' },
  });
  assert.match(md, /🌐 Opens on host — \[https:\/\/github\.com\/acme\/shop\/blob\/main\/src\/a\.ts\]\(https:/);
  assert.doesNotMatch(md, /Also on host/);
});

test('buildCodeRefHover — fell back to host, notes the missing local clone', () => {
  const md = buildCodeRefHover({
    rawPath: 'src/a.ts',
    behavior: 'localThenBrowser',
    target: { kind: 'url', value: 'https://github.com/acme/shop/blob/main/src/a.ts' },
    localCandidate: 'C:/code/shop/src/a.ts',
  });
  assert.match(md, /local clone not found — `C:\/code\/shop\/src\/a\.ts`/);
});

test('buildCodeRefHover — local-only mode, mapped file missing, no fallback', () => {
  const md = buildCodeRefHover({
    rawPath: 'src/a.ts',
    behavior: 'local',
    localCandidate: 'C:/code/shop/src/a.ts',
  });
  assert.match(md, /⚠️ Local clone not found — `C:\/code\/shop\/src\/a\.ts`/);
  assert.match(md, /no browser fallback/);
});

test('buildCodeRefHover — unresolved → single actionable config hint', () => {
  const md = buildCodeRefHover({ rawPath: 'src/a.ts', behavior: 'localThenBrowser' });
  assert.match(md, /⚠️ No destination/);
  assert.match(md, /Add a `repository:`.*`codeRef\.localRoots`/s);
});

test('buildCodeRefHover — description appended when present', () => {
  const md = buildCodeRefHover({
    rawPath: 'src/a.ts',
    behavior: 'browser',
    target: { kind: 'url', value: 'https://x/y' },
    description: 'the order aggregate',
  });
  assert.match(md, /the order aggregate$/);
});
