import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { update } from './016-bcc-domain-scope.js';

/**
 * The domain-scope rename on the three documents that declare the key, written the way the corpus
 * writes them.
 *
 * The fixtures carry every case the module must tell apart: a plain entry, a quoted value, a
 * trailing comment, an entry whose first key is the ref itself, an entry already on the new key,
 * an entry declaring both, a value that is not a scope slug, and - the case the whole scoping rule
 * exists for - a `bounded_context_ref:` belonging to something that is not one of the three.
 *
 * The negative control is the model run twice. A module that is not idempotent is unsafe in a chain
 * that may be re-run, and a second pass planning nothing is what says so.
 */
const DECISIONS_YAML = `version: "1.0.0"
scope: orders

decisions:
  - id: DC001
    title: "An ADR whose rationale names assumptions by id"
    date: "2026-01-01"
    status: accepted
    rationale:
      problem: "p"
      chosen: "c"
      assumptions:
        - ASM001
    declared_impact:
      transitive_hints:
        - "dependencies use bounded_context_ref, which this module must not read as a declaration"

business_decisions:
  - id: BD001
    name: "Refunds within 30 days"
    description: "d"
    bounded_context_ref: orders
  - id: BD002
    name: "Quoted"
    description: "d"
    bounded_context_ref: "shop-admin"   # the admin surface
  - bounded_context_ref: checkout
    id: BD003
    name: "Ref opens the entry"
    description: "d"
  - id: BD004
    name: "Already migrated"
    description: "d"
    domain_scope: orders
  - id: BD005
    name: "Declares both"
    description: "d"
    domain_scope: orders
    bounded_context_ref: checkout
  - id: BD006
    name: "Names a typed id"
    description: "d"
    bounded_context_ref: shop.BC001
`;

const MOTIVATION_YAML = `version: "1.0.0"
scope: orders

assumptions:
  - id: ASM001
    statement: "s"
    consequence: "c"
    bounded_context_ref: orders
  - id: ASM002
    statement: "s"
    consequence: "c"
`;

const QUALITY_YAML = `version: "1.0.0"
scope: orders

kpis:
  - id: KPI001
    name: "Checkout conversion"
    target: "> 3%"
    bounded_context_ref: checkout

metrics:
  - id: MT001
    name: "Orders per hour"
    type: throughput
    unit: "orders/h"
`;

/** An arch file, whose contexts and dependencies keep the key. */
const ARCH_YAML = `version: "1.0.0"
scope: orders

contexts:
  - id: BC001
    name: Orders
    kind: core
    dependencies:
      - name: Catalog
        relationship: conformist
        bounded_context_ref: shop.BC002
`;

/** A domain file, whose competency questions keep the key. */
const DOMAIN_YAML = `version: "1.0.0"
scope: orders

questions:
  - id: QN001
    question: "Which orders may still be amended?"
    bounded_context_ref: shop.BC001
`;

/** Flow form, which the module refuses in both shapes. */
const FLOW_YAML = `version: "1.0.0"
scope: flow

kpis: [{id: KPI900, name: Flow, target: "1", bounded_context_ref: flow}]

business_decisions:
  - {id: BD900, name: Flow, description: d, bounded_context_ref: flow}
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-domain-scope-'));
  fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders', 'decisions.yaml'), DECISIONS_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'orders', 'motivation.yaml'), MOTIVATION_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'orders', 'quality.yaml'), QUALITY_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'orders', 'arch.yaml'), ARCH_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'orders', 'domain.yaml'), DOMAIN_YAML, 'utf8');
  fs.writeFileSync(path.join(dir, 'flow.quality.yaml'), FLOW_YAML, 'utf8');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function read(relative: string): string {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

describe('016 BCC bounded_context_ref becomes domain_scope', () => {
  it('renames the key on a business decision, an assumption and a KPI', () => {
    update.apply(dir);
    expect(read('orders/decisions.yaml')).toContain('    domain_scope: orders\n');
    expect(read('orders/motivation.yaml')).toContain('    domain_scope: orders\n');
    expect(read('orders/quality.yaml')).toContain('    domain_scope: checkout\n');
  });

  it('leaves the value exactly as it was written, quotes included', () => {
    update.apply(dir);
    expect(read('orders/decisions.yaml')).toContain('domain_scope: "shop-admin"');
  });

  it("keeps the author's trailing comment on the line it was written on", () => {
    update.apply(dir);
    expect(read('orders/decisions.yaml')).toContain('domain_scope: "shop-admin"   # the admin surface');
  });

  it('rewrites a ref that opens its own entry, without losing the dash', () => {
    update.apply(dir);
    expect(read('orders/decisions.yaml')).toContain('  - domain_scope: checkout\n    id: BD003\n');
  });

  it('leaves an entry declaring both keys alone, because one of them is wrong', () => {
    update.apply(dir);
    expect(read('orders/decisions.yaml')).toContain('    domain_scope: orders\n    bounded_context_ref: checkout\n');
    expect(update.plan(dir).warnings.join('\n')).toMatch(
      /declares `domain_scope:` as well as `bounded_context_ref: checkout`/,
    );
  });

  it('leaves a value that is not a scope slug alone and says why', () => {
    update.apply(dir);
    expect(read('orders/decisions.yaml')).toContain('    bounded_context_ref: shop.BC001\n');
    expect(update.plan(dir).warnings.join('\n')).toMatch(
      /`bounded_context_ref: shop\.BC001` is not a kebab-case scope slug/,
    );
  });

  it('never touches an arch dependency or a competency question', () => {
    update.apply(dir);
    expect(read('orders/arch.yaml')).toBe(ARCH_YAML);
    expect(read('orders/domain.yaml')).toBe(DOMAIN_YAML);
    const warnings = update.plan(dir).warnings.join('\n');
    expect(warnings).not.toMatch(/arch\.yaml/);
    expect(warnings).not.toMatch(/domain\.yaml/);
  });

  it("never reads an ADR's nested assumptions list, nor the key's name inside prose", () => {
    update.apply(dir);
    const text = read('orders/decisions.yaml');
    expect(text).toContain('      assumptions:\n        - ASM001\n');
    expect(text).toContain('dependencies use bounded_context_ref, which this module must not read');
  });

  it('leaves flow form alone and names the file and line, in both shapes', () => {
    update.apply(dir);
    const text = read('flow.quality.yaml');
    expect(text).toBe(FLOW_YAML);
    const warnings = update.plan(dir).warnings.join('\n');
    expect(warnings).toMatch(/flow\.quality\.yaml:\d+: `kpis:` is written in flow form/);
    expect(warnings).toMatch(/flow\.quality\.yaml:\d+: the entry is written in flow form/);
  });

  it('reports what it changed, per value and per file', () => {
    const plan = update.plan(dir);
    const detail = plan.changes.map((change) => `${change.path} ${change.detail}`).join(' | ');
    expect(detail).toMatch(/orders\/decisions\.yaml 3 bounded_context_ref -> domain_scope/);
    expect(detail).toMatch(/checkout \(1\)/);
    expect(detail).toMatch(/orders\/quality\.yaml 1 bounded_context_ref -> domain_scope: checkout \(1\)/);
  });

  it('is idempotent: a second pass plans nothing new', () => {
    update.apply(dir);
    const after = read('orders/decisions.yaml');
    expect(update.plan(dir).changes).toHaveLength(0);
    update.apply(dir);
    expect(read('orders/decisions.yaml')).toBe(after);
  });

  it('plans nothing on a model that declares the key nowhere', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-domain-scope-empty-'));
    fs.writeFileSync(path.join(empty, 'quality.yaml'), 'version: "1.0.0"\nkpis: []\n', 'utf8');
    expect(update.plan(empty).changes).toHaveLength(0);
    expect(update.plan(empty).warnings).toHaveLength(0);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('keeps CRLF line endings where the file uses them', () => {
    const crlf = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-domain-scope-crlf-'));
    fs.writeFileSync(path.join(crlf, 'quality.yaml'), QUALITY_YAML.replace(/\n/g, '\r\n'), 'utf8');
    update.apply(crlf);
    const text = fs.readFileSync(path.join(crlf, 'quality.yaml'), 'utf8');
    expect(text).toContain('domain_scope: checkout\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
    fs.rmSync(crlf, { recursive: true, force: true });
  });
});
