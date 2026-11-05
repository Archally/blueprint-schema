import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './005-v28-typed-ids.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v28-typed-ids-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const full = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

const read = (relativePath: string): string => fs.readFileSync(path.join(dir, relativePath), 'utf8');

/** An arch document in the shape the corpus actually uses: party -> contexts -> services. */
const ARCH = (body: string) => `version: "1.0.0"\nparties:\n  - id: PRT001\n    name: Acme\n    env: production\n${body}`;

const ONE_CONTEXT = ARCH(
  '    contexts:\n' +
    '      - name: Orders\n' +
    '        kind: core\n' +
    '        services:\n' +
    '          - name: OrderService\n' +
    '            description: Handles orders.\n',
);

describe('005 v2.8 typed ids - minting BC### and SVC###', () => {
  it('gives a context without an id the next free BC###', () => {
    write('arch.yaml', ONE_CONTEXT);
    expect(update.apply(dir).applied).toBe(true);
    expect(read('arch.yaml')).toContain('      - id: BC001\n        name: Orders');
  });

  it('gives a service without an id the next free SVC###', () => {
    write('arch.yaml', ONE_CONTEXT);
    update.apply(dir);
    expect(read('arch.yaml')).toContain('          - id: SVC001\n            name: OrderService');
  });

  it('allocates above every id of that family already used anywhere in the model', () => {
    write('arch.yaml', ONE_CONTEXT);
    // Not in an arch file, and not even an arch entity - the point is that an allocation may never
    // collide with a token the model already uses, wherever it lives.
    write('decisions.yaml', 'decisions:\n  - id: RD001\n    contexts: [BC004, BC009]\n');
    update.apply(dir);
    expect(read('arch.yaml')).toContain('id: BC010');
  });

  it('gives one context declared across two slice files a single id', () => {
    write('orders/arch.yaml', ONE_CONTEXT);
    write('billing/arch.yaml', ONE_CONTEXT);
    update.apply(dir);
    expect(read('orders/arch.yaml')).toContain('id: BC001');
    expect(read('billing/arch.yaml')).toContain('id: BC001');
  });

  it('gives two services of the SAME name in different contexts different ids', () => {
    // A service name is unique within its context, not within the model. Keying on the bare name
    // would silently merge two services into one node.
    write(
      'arch.yaml',
      ARCH(
        '    contexts:\n' +
          '      - name: Orders\n' +
          '        services:\n' +
          '          - name: Api\n' +
          '      - name: Billing\n' +
          '        services:\n' +
          '          - name: Api\n',
      ),
    );
    update.apply(dir);
    const content = read('arch.yaml');
    expect(content).toContain('id: SVC001');
    expect(content).toContain('id: SVC002');
  });

  it('leaves an id that is already present alone', () => {
    write(
      'arch.yaml',
      ARCH('    contexts:\n      - id: BC007\n        name: Orders\n        services: []\n'),
    );
    expect(update.plan(dir).changes.filter((c) => c.detail.includes('BC'))).toHaveLength(0);
  });

  it('does not mint into `contexts: []`, which is the schema\'s own way of saying "none here"', () => {
    write('arch.yaml', ARCH('    contexts: []\n'));
    // Filtered to MINTS, not to every `edit-yaml`: the fixture's party carries `env`, which the hop
    // removes, so a type-wide filter would count an unrelated edit and read as a minting defect.
    expect(update.plan(dir).changes.filter((c) => c.detail.includes('-> id: '))).toHaveLength(0);
  });

  it('does not treat a nested `- name:` as a context entry', () => {
    write(
      'arch.yaml',
      ARCH(
        '    contexts:\n' +
          '      - name: Orders\n' +
          '        responsibilities:\n' +
          '          - name: not-a-context\n' +
          '        services: []\n',
      ),
    );
    const minted = update.plan(dir).changes.filter((c) => c.detail.startsWith('context'));
    expect(minted).toHaveLength(1);
    expect(minted[0]!.detail).toContain('"Orders"');
  });
});

describe('005 v2.8 typed ids - the scope prefix is adopted only when the model is unanimous', () => {
  it('adopts the scope every existing id of the family already carries', () => {
    write('orders/arch.yaml', ONE_CONTEXT);
    write(
      'catalog/arch.yaml',
      ARCH('    contexts:\n      - id: shop.BC001\n        name: Catalog\n        services: []\n'),
    );
    update.apply(dir);
    expect(read('orders/arch.yaml')).toContain('id: shop.BC002');
  });

  it('mints bare when the model mixes scopes, because a mixture states no single convention', () => {
    write('orders/arch.yaml', ONE_CONTEXT);
    write(
      'catalog/arch.yaml',
      ARCH(
        '    contexts:\n' +
          '      - id: shop.BC001\n        name: Catalog\n        services: []\n' +
          '      - id: warehouse.BC001\n        name: Stock\n        services: []\n',
      ),
    );
    update.apply(dir);
    expect(read('orders/arch.yaml')).toContain('id: BC001');
  });

  it('mints bare when the model has no id of that family yet', () => {
    write('arch.yaml', ONE_CONTEXT);
    update.apply(dir);
    expect(read('arch.yaml')).toContain('id: BC001');
    expect(read('arch.yaml')).not.toContain('.BC001');
  });

  it('keeps the width the model already uses rather than forcing three digits', () => {
    write('orders/arch.yaml', ONE_CONTEXT);
    write(
      'catalog/arch.yaml',
      ARCH('    contexts:\n      - id: BC0042\n        name: Catalog\n        services: []\n'),
    );
    update.apply(dir);
    expect(read('orders/arch.yaml')).toContain('id: BC0043');
  });
});

const INFRA = [
  'resources:',
  '  - id: catalog-api',
  '    kind: api',
  '    name: Catalog API',
  '    relations:',
  '      - type: depends_on',
  '        target: orders-db',
  '  - id: orders-db',
  '    kind: database',
  '    name: Orders DB',
  '',
].join('\n');

describe('005 v2.8 typed ids - retyping IR### and its references', () => {
  it('retypes a free-string resource id', () => {
    write('infrastructure.yaml', INFRA);
    expect(update.apply(dir).applied).toBe(true);
    expect(read('infrastructure.yaml')).toContain('  - id: IR001\n');
    expect(read('infrastructure.yaml')).toContain('  - id: IR002\n');
  });

  it('rewrites the TOSCA relation target in the same pass', () => {
    // The whole reason retyping is a different transform from minting: the id already EXISTS, so
    // it is already referenced. A retype that moved the declaration alone would leave the model
    // dangling, and `bp validate` would report a missing reference rather than a rename.
    write('infrastructure.yaml', INFRA);
    update.apply(dir);
    expect(read('infrastructure.yaml')).toContain('        target: IR002');
    expect(read('infrastructure.yaml')).not.toContain('orders-db');
  });

  it('rewrites a reference held in another document', () => {
    write('infrastructure.yaml', INFRA);
    write('test-cases.yaml', 'happy_path:\n  - id: TC001\n    infrastructure:\n      - catalog-api\n');
    update.apply(dir);
    expect(read('test-cases.yaml')).toContain('      - IR001');
  });

  it('rewrites a reference held in a flow sequence', () => {
    write('infrastructure.yaml', INFRA);
    write('quality.yaml', 'slos:\n  - id: SLO001\n    resource_refs: [catalog-api, orders-db]\n');
    update.apply(dir);
    expect(read('quality.yaml')).toContain('resource_refs: [IR001, IR002]');
  });

  it('lists every reference it will rewrite in the PLAN, not only in the result', () => {
    // `plan` is what `--dry-run` prints, and the guide tells an operator to read it before
    // applying. A plan that omits the reference rewrites describes a migration nobody is going to
    // get: the model would change in ways the preview never mentioned. Asserted separately from
    // the apply-side tests because the two read the same analysis through different code.
    write('infrastructure.yaml', INFRA);
    write('test-cases.yaml', 'happy_path:\n  - id: TC001\n    infrastructure:\n      - catalog-api\n');
    const details = update.plan(dir).changes.map((c) => `${c.path} ${c.detail}`);
    expect(details).toContain('infrastructure.yaml line 7: `target` "orders-db" -> IR002');
    expect(details).toContain('test-cases.yaml line 4: `infrastructure` "catalog-api" -> IR001');
  });

  it('leaves an already-typed resource id and its references alone', () => {
    write('infrastructure.yaml', 'resources:\n  - id: IR005\n    kind: api\n    name: A\n');
    expect(update.plan(dir).changes.filter((c) => c.detail.includes('->'))).toHaveLength(0);
  });

  it('does NOT rewrite `target:` outside an infrastructure document', () => {
    // `target` is a common word. The schema declares it as an IR ref only inside an infrastructure
    // document, so applying it everywhere would rewrite an unrelated field that happened to match.
    write('infrastructure.yaml', INFRA);
    write('roadmap.yaml', 'work_items:\n  - id: WI001\n    target: catalog-api\n');
    update.apply(dir);
    expect(read('roadmap.yaml')).toContain('target: catalog-api');
  });

  it('reports the occurrence it declined to rewrite instead of staying silent', () => {
    write('infrastructure.yaml', INFRA);
    write('roadmap.yaml', 'work_items:\n  - id: WI001\n    target: catalog-api\n');
    const { warnings } = update.plan(dir);
    expect(warnings.some((w) => w.includes('roadmap.yaml:3') && w.includes('catalog-api'))).toBe(true);
  });

  it('does not warn about the id appearing inside prose', () => {
    // The warning tests the WHOLE scalar. A free-string id reads like ordinary text, and one
    // warning per prose mention buries the few that are real references.
    write('infrastructure.yaml', INFRA);
    write('decisions.yaml', 'decisions:\n  - id: RD001\n    rationale: The catalog-api owns this.\n');
    const { warnings } = update.plan(dir);
    expect(warnings.filter((w) => w.includes('decisions.yaml'))).toHaveLength(0);
  });

  it('retypes a deployment scope and its `parent` chain', () => {
    write(
      'infrastructure.yaml',
      'deployment_scopes:\n' +
        '  - id: prod-subscription\n    name: Prod\n    kind: subscription\n' +
        '  - id: prod-rg\n    name: Prod RG\n    kind: resource_group\n    parent: prod-subscription\n',
    );
    update.apply(dir);
    const content = read('infrastructure.yaml');
    expect(content).toContain('  - id: DSC001\n');
    expect(content).toContain('  - id: DSC002\n');
    expect(content).toContain('    parent: DSC001');
  });
});

describe('005 v2.8 typed ids - version bump and directory move', () => {
  it('bumps schemaVersion wherever it is declared, not only in blueprint.yaml', () => {
    write('blueprint.yaml', 'name: X\nschemaVersion: "2.7.0"\n');
    write('orders/domain.yaml', 'schemaVersion: "2.7.0"\noperations: []\n');
    update.apply(dir);
    expect(read('blueprint.yaml')).toContain('schemaVersion: "2.8.0"');
    expect(read('orders/domain.yaml')).toContain('schemaVersion: "2.8.0"');
  });

  it('does not rewrite a schemaVersion mentioned in prose', () => {
    // Only a schemaVersion declaration at column 0 is updated; mentions inside prose stay intact.
    write(
      'migrations.yaml',
      'migrations:\n  - id: MIG001\n    description: >\n      Bumped schemaVersion: "2.6.0" to "2.7.0".\n',
    );
    expect(update.plan(dir).changes.filter((c) => c.detail.includes('schemaVersion'))).toHaveLength(0);
  });

  it('preserves the quoting style the file already used', () => {
    write('blueprint.yaml', "schemaVersion: '2.7.0'\n");
    update.apply(dir);
    expect(read('blueprint.yaml')).toBe("schemaVersion: '2.8.0'\n");
  });

  it('copies a v2.7 directory to v2.8 and leaves v2.7 exactly as it was', () => {
    const model = path.join(dir, 'v2.7');
    fs.mkdirSync(model);
    fs.writeFileSync(path.join(model, 'blueprint.yaml'), 'schemaVersion: "2.7.0"\n', 'utf8');
    expect(update.apply(model).applied).toBe(true);
    // The copy is taken before any edit, so the two trees each state their own version. A source
    // left holding `2.8.0` under the name `v2.7` would be the failure this asserts against.
    expect(fs.readFileSync(path.join(dir, 'v2.8', 'blueprint.yaml'), 'utf8')).toContain('2.8.0');
    expect(fs.readFileSync(path.join(dir, 'v2.7', 'blueprint.yaml'), 'utf8')).toBe('schemaVersion: "2.7.0"\n');
  });

  it('refuses rather than merging when the target directory already exists', () => {
    const model = path.join(dir, 'v2.7');
    fs.mkdirSync(model);
    fs.writeFileSync(path.join(model, 'blueprint.yaml'), 'schemaVersion: "2.7.0"\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'v2.8'));
    fs.writeFileSync(path.join(dir, 'v2.8', 'keep.yaml'), 'mine: true\n', 'utf8');
    const result = update.apply(model);
    expect(result.applied).toBe(false);
    expect(result.errors.join(' ')).toContain('already exists');
    // Neither tree is touched: a copy that merged would be silent and unrecoverable.
    expect(fs.readFileSync(path.join(dir, 'v2.7', 'blueprint.yaml'), 'utf8')).toBe('schemaVersion: "2.7.0"\n');
    expect(fs.readdirSync(path.join(dir, 'v2.8'))).toEqual(['keep.yaml']);
  });

  it('leaves a directory that is not named v2.7 where it is', () => {
    write('blueprint.yaml', 'schemaVersion: "2.7.0"\n');
    update.apply(dir);
    expect(update.plan(dir).changes.some((c) => c.type === 'copy-directory')).toBe(false);
  });
});

describe('005 v2.8 typed ids - what it reports rather than does', () => {
  it('reports a party with no PRT### instead of minting one', () => {
    // Module `004` mints party ids, including the org-part adoption rule, and runs before this one
    // in the chain. Minting here would be a second implementation of one transform; reporting keeps
    // a chain that skipped `004` visible.
    write('arch.yaml', 'parties:\n  - name: Acme\n    env: production\n    contexts: []\n');
    const { warnings, changes } = update.plan(dir);
    expect(warnings.some((w) => w.includes('004'))).toBe(true);
    expect(changes.filter((c) => c.detail.includes('PRT'))).toHaveLength(0);
  });

  it('reports a flow-style parties block instead of rewriting it', () => {
    write('arch.yaml', 'parties: [{ name: Acme }]\n');
    expect(update.plan(dir).warnings.some((w) => w.includes('flow-style'))).toBe(true);
  });

  it('reports a context entry with no name rather than inventing an identity for it', () => {
    write('arch.yaml', ARCH('    contexts:\n      - kind: core\n        services: []\n'));
    expect(update.plan(dir).warnings.some((w) => w.includes('without a name'))).toBe(true);
  });

  it('reports a missing directory rather than throwing', () => {
    const plan = update.plan(path.join(dir, 'nope'));
    expect(plan.changes).toHaveLength(0);
    expect(plan.warnings[0]).toContain('Directory not found');
  });
});

describe('005 v2.8 typed ids - safety', () => {
  it('is idempotent: a second run plans nothing', () => {
    write('arch.yaml', ONE_CONTEXT);
    write('infrastructure.yaml', INFRA);
    write('blueprint.yaml', 'schemaVersion: "2.7.0"\n');
    update.apply(dir);
    const second = update.plan(dir);
    expect(second.changes).toHaveLength(0);
  });

  it('preserves comments, key order and blank lines', () => {
    write(
      'arch.yaml',
      'parties:\n' +
        '  - id: PRT001\n' +
        '    name: Acme\n' +
        '    contexts:\n' +
        '      # the core of the domain\n' +
        '      - name: Orders\n' +
        '\n' +
        '        kind: core\n' +
        '        services: []\n',
    );
    update.apply(dir);
    const content = read('arch.yaml');
    expect(content).toContain('      # the core of the domain');
    expect(content).toContain('      - id: BC001\n        name: Orders\n\n        kind: core');
  });

  it('preserves CRLF line endings and never mixes them', () => {
    write('arch.yaml', ONE_CONTEXT.replace(/\n/g, '\r\n'));
    update.apply(dir);
    const content = read('arch.yaml');
    expect(content).toContain('\r\n');
    expect(content.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('keeps keys aligned when the dash uses non-standard spacing', () => {
    write('arch.yaml', ARCH('    contexts:\n      -   name: Orders\n          services: []\n'));
    update.apply(dir);
    expect(read('arch.yaml')).toContain('      -   id: BC001\n          name: Orders');
  });

  it('writes both transforms into one file without either overwriting the other', () => {
    // Mint and retype queue edits into the same splice pass. Applying them in ascending offset
    // order would invalidate every later offset; this is the assertion that catches it.
    write(
      'infrastructure.yaml',
      'resources:\n  - id: catalog-api\n    kind: api\n  - id: orders-db\n    kind: database\n',
    );
    update.apply(dir);
    const content = read('infrastructure.yaml');
    expect(content).toContain('  - id: IR001\n    kind: api');
    expect(content).toContain('  - id: IR002\n    kind: database');
  });
});

describe('005 v2.8 typed ids - the surfaces v2.8 no longer accepts are reported, never rewritten', () => {
  const removed = (): string[] => update.plan(dir).warnings.filter((w) => w.includes('not accepted from v2.8'));

  it('reports a service `resources` list written in flow style, by file and line', () => {
    write('arch.yaml', ARCH('    contexts:\n      - id: BC001\n        name: Orders\n        services:\n          - id: SVC001\n            name: OrderService\n            resources: [database, queue]\n'));
    const found = removed();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('arch.yaml:12');
    expect(found[0]).toContain('"OrderService"');
    expect(found[0]).toContain('resource_refs');
  });

  it('reports a service `resources` list written as a block', () => {
    write('arch.yaml', ARCH('    contexts:\n      - id: BC001\n        name: Orders\n        services:\n          - id: SVC001\n            name: OrderService\n            resources:\n              - database\n'));
    const found = removed();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('arch.yaml:12');
  });

  it('reports the root `infrastructure:` map whether it opens a block or holds a flow mapping', () => {
    write('orders/arch.yaml', ARCH('    contexts: []\n') + 'infrastructure:\n  legacy-db: "the shared database"\n');
    write('billing/arch.yaml', 'version: "1.0.0"\ninfrastructure: { crm: "Salesforce" }\nparties: []\n');
    const found = removed();
    expect(found).toHaveLength(2);
    expect(found.some((w) => w.startsWith('orders/arch.yaml:7:') && w.includes('root `infrastructure:` map'))).toBe(true);
    expect(found.some((w) => w.startsWith('billing/arch.yaml:2:'))).toBe(true);
  });

  it('leaves the line in place and still bumps the version, so the validator names the property', () => {
    write('arch.yaml', ARCH('    contexts:\n      - id: BC001\n        name: Orders\n        services:\n          - id: SVC001\n            name: OrderService\n            resources: [database]\n'));
    write('blueprint.yaml', 'schemaVersion: "2.7.0"\nname: x\n');
    const result = update.apply(dir);
    expect(result.applied).toBe(true);
    expect(read('arch.yaml')).toContain('resources: [database]');
    expect(read('blueprint.yaml')).toContain('schemaVersion: "2.8.0"');
    expect(result.warnings.some((w) => w.includes('not accepted from v2.8'))).toBe(true);
  });

  it('does not mistake the `resources:` container of an infrastructure document for the removed list', () => {
    write('infrastructure.yaml', 'resources:\n  - id: IR001\n    name: orders-db\n    kind: database\n');
    write('arch.yaml', ARCH('    contexts:\n      - id: BC001\n        name: Orders\n        services:\n          - id: SVC001\n            name: OrderService\n            resource_refs: [IR001]\n'));
    expect(removed()).toHaveLength(0);
  });

  it('does not report a service that names its resources the typed way', () => {
    write('arch.yaml', ARCH('    contexts:\n      - id: BC001\n        name: Orders\n        services:\n          - id: SVC001\n            name: OrderService\n            resource_refs:\n              - IR001\n'));
    expect(removed()).toHaveLength(0);
  });
});
