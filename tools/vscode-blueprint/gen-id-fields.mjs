#!/usr/bin/env node
// @ts-check
//
// Derive "which typed id may this field hold?" from the schema suite, and emit it as a table.
//
// The knowledge is already in the schemas and is stated twice over: a property that holds a
// reference says `$ref: ../metamodel.schema.yaml#/$defs/<name>_ref`, and that def states a
// `pattern` whose alternation lists the id prefixes it accepts (`(CMD|EVT|QRY|DOC)`). Joining the
// two gives `triggers_operations -> CMD, EVT, QRY, DOC` with no judgement of ours in the middle.
//
// It runs OFFLINE and commits its output, rather than parsing schemas when the editor starts.
// Two reasons: the extension would otherwise need a YAML parser and the schema tree on disk at
// activation, and a table that is read at startup fails silently in the one case that matters -
// a packaged VSIX whose schema copy did not travel. The cost is that the table is a snapshot:
// when a schema adds or renames a reference field, re-run this and commit the result. The
// `--check` mode makes that omission loud rather than silent.
//
// Usage: node gen-id-fields.mjs [--check]
// Exit 0 written / in sync · 1 out of sync under --check · 2 no schema tree found.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'src', 'idFields.generated.ts');

// `yaml` is resolved from the monorepo root - this is a build-time script, never shipped code.
const require = createRequire(join(HERE, '../../../package.json'));
/** @type {{ parse: (s: string) => any }} */
const YAML = require('yaml');

/** Where a schema tree may live, relative to this file. First match wins; none is an error. */
const CANDIDATES = [
  '../../../schemas/blueprint/v2.8/schema', // monorepo
  '../../schema/v2.8',                      // publication repo
  './schema',                               // the copy sync-schema.mjs places for packaging
];

const source = CANDIDATES.map((c) => resolve(HERE, c)).find((p) => existsSync(join(p, 'metamodel.schema.yaml')));
if (!source) {
  console.error('gen-id-fields: no schema tree found. Looked under:\n'
    + CANDIDATES.map((c) => '  ' + resolve(HERE, c)).join('\n'));
  process.exit(2);
}

// ── 1. metamodel `*_ref` defs -> the id prefixes their pattern accepts ───────────────────────────

const metamodel = YAML.parse(readFileSync(join(source, 'metamodel.schema.yaml'), 'utf8'));
const defs = metamodel['$defs'] ?? {};

/** Every `PREFIX` an id pattern accepts: `^([a-z][a-z0-9-]*\.)?(CMD|EVT)\d{3,}$` -> ['CMD','EVT']. */
function prefixesFromPattern(pattern) {
  if (typeof pattern !== 'string') return [];
  // Strip the optional scope group, then read the literal/alternation that precedes the digits.
  const tail = pattern.replace(/^\^\(\[a-z\]\[a-z0-9-\]\*\\\.\)\?/, '').replace(/^\^/, '');
  const m = tail.match(/^\(([A-Z|]+)\)\\d|^([A-Z]+)\\d/);
  if (!m) return [];
  return (m[1] ?? m[2]).split('|').filter(Boolean);
}

/** A def may state its pattern directly or under `anyOf`; collect prefixes from every branch. */
function prefixesForDef(def) {
  if (!def || typeof def !== 'object') return [];
  const found = new Set();
  for (const p of prefixesFromPattern(def.pattern)) found.add(p);
  for (const branch of def.anyOf ?? def.oneOf ?? []) {
    for (const p of prefixesFromPattern(branch?.pattern)) found.add(p);
  }
  return [...found];
}

/** ref-def name -> prefixes, for every `*_ref` def that yields at least one. */
const refPrefixes = new Map();
for (const [name, def] of Object.entries(defs)) {
  if (!name.endsWith('_ref')) continue;
  const prefixes = prefixesForDef(def);
  if (prefixes.length) refPrefixes.set(name, prefixes);
}

// ── 2. walk every document schema, recording property -> ref-def ─────────────────────────────────

function schemaFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...schemaFiles(p));
    else if (entry.name.endsWith('.schema.yaml')) out.push(p);
  }
  return out;
}

/** The `<name>_ref` a `$ref` string points at, or undefined. */
const refDefName = (s) => (typeof s === 'string' ? s.match(/#\/\$defs\/([a-z_]+_ref)$/)?.[1] : undefined);

/** field name -> Set of prefixes, unioned across every schema that declares that field. */
const fields = new Map();
const add = (field, prefixes) => {
  if (!fields.has(field)) fields.set(field, new Set());
  for (const p of prefixes) fields.get(field).add(p);
};

/**
 * Field names that hold ENTITY DECLARATIONS somewhere in the suite.
 *
 * The same word is a reference in one document and a container in another: `actions:` is a list of
 * `ui_action_ref` in test-cases.yaml, and the list of action OBJECTS in interactions.yaml. A table
 * keyed by field name alone cannot tell the two apart, and offering existing ids where the author
 * is declaring a new one is worse than offering nothing - so a name used as a container anywhere is
 * withheld everywhere. The cost is named in the report: `actions` and `navigation` do not complete
 * in test-cases.yaml or decisions.yaml.
 */
const containers = new Set();

/** A local `#/$defs/x` whose object has an `id` property - i.e. a declaration, not a reference. */
function declaresEntity(ref, root) {
  const name = typeof ref === 'string' ? ref.match(/^#\/\$defs\/([A-Za-z0-9_]+)$/)?.[1] : undefined;
  return name ? Boolean(root?.['$defs']?.[name]?.properties?.id) : false;
}

/**
 * Every `$ref` a property spec can reach without leaving it: directly, through `items`, and through
 * a `oneOf`/`anyOf` branch of either. `environments:` states `items.oneOf: [string, #/$defs/environment]`,
 * so a check that reads only `items.$ref` calls a container a reference field.
 */
function localRefsOf(spec) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node['$ref'] === 'string') out.push(node['$ref']);
    for (const branch of node.oneOf ?? []) visit(branch);
    for (const branch of node.anyOf ?? []) visit(branch);
  };
  visit(spec);
  visit(spec.items);
  return out;
}

/** Walk a schema node, treating any `properties` map as field declarations. */
function walk(node, root) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, root); return; }

  if (node.properties && typeof node.properties === 'object') {
    for (const [field, spec] of Object.entries(node.properties)) {
      if (!spec || typeof spec !== 'object') continue;
      // `field: <ref>` - a scalar reference.
      let name = refDefName(spec['$ref']);
      // `field: [<ref>, ...]` - an array of references.
      if (!name && spec.type === 'array') name = refDefName(spec.items?.['$ref']);
      if (name && refPrefixes.has(name)) add(field, refPrefixes.get(name));

      if (localRefsOf(spec).some((ref) => declaresEntity(ref, root))) containers.add(field);
    }
  }
  for (const value of Object.values(node)) walk(value, root);
}

for (const file of schemaFiles(source)) {
  const root = YAML.parse(readFileSync(file, 'utf8'));
  walk(root, root);
}

// `id:` declares an entity rather than referencing one - completing it would offer ids already taken.
fields.delete('id');
for (const name of containers) fields.delete(name);

// ── 3. emit ──────────────────────────────────────────────────────────────────────────────────────

const rows = [...fields.entries()]
  .map(([field, set]) => [field, [...set].sort()])
  .sort((a, b) => a[0].localeCompare(b[0]));

const version = source.match(/v(\d+\.\d+)/)?.[1] ?? 'unknown';
const body = `// GENERATED by gen-id-fields.mjs from blueprint schema v${version} - do not edit by hand.
//
// Which typed id prefixes each reference field accepts, read from the \`$ref\` each property
// declares and the \`pattern\` of the metamodel def behind it. Re-run \`npm run gen-id-fields\`
// after a schema change; \`npm run gen-id-fields:check\` fails when this file is behind.

export const ID_FIELD_PREFIXES: Readonly<Record<string, readonly string[]>> = Object.freeze({
${rows.map(([field, prefixes]) => `  ${/^[a-z_][a-z0-9_]*$/i.test(field) ? field : JSON.stringify(field)}: [${prefixes.map((p) => `'${p}'`).join(', ')}],`).join('\n')}
});

/** Every prefix any reference field accepts - the set an id must carry to be completable. */
export const ALL_REF_PREFIXES: readonly string[] = Object.freeze(
  [...new Set(Object.values(ID_FIELD_PREFIXES).flat())].sort(),
);
`;

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== body) {
    console.error('gen-id-fields: src/idFields.generated.ts is out of sync with ' + source);
    console.error('Run: npm run gen-id-fields');
    process.exit(1);
  }
  console.log(`gen-id-fields: in sync (${rows.length} fields, schema v${version}).`);
  process.exit(0);
}

writeFileSync(OUT, body);
console.log(`gen-id-fields: wrote ${rows.length} reference fields from schema v${version}.`);
console.log(rows.map(([f, p]) => `  ${f.padEnd(26)} ${p.join(', ')}`).join('\n'));
