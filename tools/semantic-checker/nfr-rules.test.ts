import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';
import { loadFromMap, buildBlueprintModel } from '@archally/blueprint-schema/model';
import { toCheckableModel } from './adapter.js';
import { classifyRequirement } from './rules/nfr-fields.mjs';

/**
 * The rules about a model's non-functional requirements, exercised end-to-end through the public
 * pipeline (`loadFromMap` -> `buildBlueprintModel` -> `toCheckableModel` -> `runChecker`) against
 * the rule pack in `./rules`.
 *
 * The fixtures below are kept byte-identical to the ones the same rule pack is tested with on
 * another model builder and adapter: one YAML, one rule pack, two stacks, so the finding sets must
 * agree. If they diverge, one rule means two things depending on which stack ran it. Do not edit a
 * fixture here alone.
 *
 * The fixture is derived from the ecommerce example's orders metrics, SLOs, KPIs and security,
 * compliance and resilience requirements, prose shortened. Each record is a violator or a compliant
 * sibling of one rule, and the comment beside it says which. Records the example does not hold are
 * added so that every branch has a case: an SLO naming no metric and one naming a metric no entity
 * declares, an SLA, and fitness functions with and without a quality characteristic.
 */

const FIXTURE = new Map<string, string>([
  [
    'blueprint.yaml',
    `version: "1.0.0"
schemaVersion: "2.8.0"
name: NFR rules fixture
`,
  ],
  [
    'instruments.arch.yaml',
    `version: "1.0.0"
name: Order instruments
parties: []
contexts: []
probes:
  - id: PRB001
    name: Service health endpoints
    question: "Does each order service answer its health route right now?"
    source_kind: running system
    status: active
    implementation: as-is
`,
  ],
  [
    'delivery.roadmap.yaml',
    `version: "1.0.0"
schemaVersion: "2.8.0"
milestones: []
work_items:
  - id: WI001
    kind: task
    name: "A load test measures peak order throughput"
`,
  ],
  [
    'orders/domain.yaml',
    `version: "1.0.0"
scope: orders
name: Orders
operations:
  placeOrder:
    id: orders.CMD001
    kind: command
    name: Place Order
`,
  ],
  [
    'orders/quality.yaml',
    `version: "1.0.0"
scope: orders
metrics:
  # evidence rule: confirmed without evidence on a metric -> reported
  - id: orders.MT001
    name: Order submission latency
    type: latency
    unit: ms
    measures:
      operations: [orders.CMD001]
    quality_characteristic: performance-efficiency
    collection:
      method: automated
      source: APM
    provenance:
      certainty: confirmed
  # evidence rule: probable without evidence -> not reported
  - id: orders.MT002
    name: Order submission success rate
    type: availability
    unit: "%"
    provenance:
      certainty: probable
  # objective-without-measurement: the metrics behind the objectives, one per measurement state
  - id: orders.MT003
    name: Order history response time
    type: latency
    unit: ms
    collection:
      method: automated
  - id: orders.MT004
    name: Payment authorisation time
    type: latency
    unit: ms
    collection:
      method: automated
      status: measured
      probe_ref: PRB001
      results_location: "https://grafana.example.com/d/payment-authorisation"
  - id: orders.MT005
    name: Calls from new code into the legacy order module
    type: custom
    unit: count
    collection:
      method: automated
      frequency: one-off
      status: measured
      results_location: "reports/2026-q3-coupling.md"
  - id: orders.MT006
    name: Order service uptime
    type: availability
    unit: "%"
    collection:
      status: not-measured
      probe_ref: PRB001
  - id: orders.MT007
    name: Orders cancelled within an hour
    type: custom
    unit: "%"
    collection:
      status: not-measured
  - id: orders.MT008
    name: Peak orders per minute without errors
    type: throughput
    unit: orders/min
    collection:
      status: no-instrument
      work_item_ref: WI001
  - id: orders.MT009
    name: Order confirmation mail delay
    type: latency
    unit: s
    collection:
      status: no-instrument
slos:
  # metric rules: names a metric -> not reported; evidence rule: confirmed with evidence -> not reported
  - id: orders.SLO001
    name: Order API availability
    target: 99.9%
    metric: orders.MT002
    provenance:
      discovery_stage: committed
      certainty: confirmed
      evidence:
        - kind: stakeholder-signoff
          source: "product owner"
          date: "2026-10-04"
          summary: "The product owner set this availability."
  # slo-without-metric: names no metric -> reported
  - id: orders.SLO002
    name: Order submission latency p95
    target: "p95 under two seconds"
  # slo-without-metric: names a metric no entity declares -> reported, saying so
  - id: orders.SLO003
    name: Order history answers fast
    target: "p95 under 300 ms"
    metric: orders.MT999
  # objective-without-measurement: status not stated -> reported, message (1)
  - id: orders.SLO004
    name: Order history stays fast
    target: "p95 under 400 ms"
    objective: { comparator: le, value: 400, statistic: p95 }
    metric: orders.MT003
  # objective-without-measurement: measured with a probe -> not reported
  - id: orders.SLO005
    name: Payment authorisation within a second
    target: "p95 under one second"
    objective: { comparator: lt, value: 1000, statistic: p95 }
    metric: orders.MT004
  # objective-without-measurement: measured with no probe -> reported, message (2)
  - id: orders.SLO006
    name: Calls into the legacy module never rise
    target: "no more than 42 calls"
    objective: { comparator: le, value: 42 }
    metric: orders.MT005
  # objective-without-measurement: not measured, with a probe -> reported, message (3) naming it
  - id: orders.SLO007
    name: Order service stays up
    target: "99.9% of every month"
    objective: { comparator: ge, value: 99.9 }
    metric: orders.MT006
  # objective-without-measurement: no instrument and no work item -> reported, message (4)
  - id: orders.SLO008
    name: Confirmation mail within a minute
    target: "within 60 s"
    objective: { comparator: le, value: 60 }
    metric: orders.MT009
  # an objective and no metric: slo-without-metric only, never objective-without-measurement
  - id: orders.SLO009
    name: Checkout answers fast
    target: "p95 under 800 ms"
    objective: { comparator: le, value: 800, statistic: p95 }
  # a metric whose status is not stated, and no objective: not a subject of objective-without-measurement
  - id: orders.SLO010
    name: Order history rarely times out
    target: "rarely"
    metric: orders.MT003
slas:
  # evidence rule: an SLA confirmed without evidence -> reported
  # requirement-unverified: the sla_slo edge into orders.SLO002 does not verify it
  - id: orders.SLA001
    name: Order service agreement
    slos: [orders.SLO001, orders.SLO002]
    provenance:
      certainty: confirmed
security:
  # evidence rule: confirmed with evidence -> not reported
  - id: orders.SEC001
    name: JWT authentication
    type: authentication
    requirement: All order API endpoints require valid JWT bearer token
    provenance:
      certainty: confirmed
      evidence:
        - kind: codebase-analysis
          date: "2026-10-04"
          summary: "Every order route is behind the token middleware."
  # evidence rule: confirmed without evidence -> reported
  - id: orders.SEC002
    name: Order ownership authorization
    type: authorization
    requirement: Customers can only access their own orders
    provenance:
      certainty: confirmed
      evidence: []
compliance:
  # evidence rule: committed with no certainty -> not reported (discovery_stage is not read)
  - id: orders.CMP001
    name: Order data retention
    regulation: GDPR
    requirement: Order data containing PII must be retained for max 7 years
    provenance:
      discovery_stage: committed
resilience:
  - id: orders.RES001
    name: Order service availability
    type: availability
kpis:
  # kpi-without-metric: names a metric -> not reported; evidence rule: confirmed without evidence -> reported
  - id: orders.KPI001
    name: Order submission success rate
    target: "> 99%"
    metric: orders.MT002
    provenance:
      certainty: confirmed
  # kpi-without-metric: names no metric -> reported
  - id: orders.KPI002
    name: Orders placed per day
    target: "more than last month"
  # objective-without-measurement: not measured, no probe -> reported, message (3)
  - id: orders.KPI003
    name: Cancellations within an hour
    target: "under 2%"
    objective: { comparator: lt, value: 2 }
    metric: orders.MT007
  # objective-without-measurement: no instrument, a work item builds it -> reported, message (4) naming it
  - id: orders.KPI004
    name: Peak order throughput
    target: "at least 300 orders a minute"
    objective: { comparator: ge, value: 300 }
    metric: orders.MT008
`,
  ],
  [
    'orders/test-cases.yaml',
    `version: "1.0.0"
scope: orders
fitness_functions:
  # evidence rule: a constraint confirmed without evidence -> reported
  - id: orders.FF001
    name: Order submission stays within two seconds
    assertion: "Every release keeps the p95 of order submission latency below 2,000 ms."
    quality_characteristic: performance-efficiency
    metric: orders.MT001
    provenance:
      certainty: confirmed
  # evidence rule: a guard (no quality characteristic) confirmed without evidence -> not reported
  - id: orders.FF002
    name: Order routes keep their token check
    assertion: "An architecture test fails a release whose order route skips the token middleware."
    verifies:
      security: [orders.SEC001]
    provenance:
      certainty: confirmed
  # requirement-unverified: verifies an SLO, a KPI and a compliance requirement
  - id: orders.FF003
    name: Availability and retention stay within their agreements
    assertion: "A release keeps order availability and the retention job within their agreements."
    verifies:
      slos: [orders.SLO001]
      kpis: [orders.KPI001]
      compliance: [orders.CMP001]
`,
  ],
]);

/**
 * References that link nothing, for the cases the orders fixture does not hold: a `metric` that two
 * entities declare (one `MT100` in orders, one in billing, both without a scope prefix), one no
 * entity declares and one naming an entity of another type, for an SLO and a KPI each; and
 * `probe_ref`s that name no probe (a dangling id, an entity of another type) or a probe the model
 * plans (PRB001, a candidate not yet built). Kept apart so the orders fixture's counts stay as they
 * are.
 */
const REFERENCE_FIXTURE = new Map<string, string>([
  ['blueprint.yaml', 'version: "1.0.0"\nschemaVersion: "2.8.0"\nname: NFR reference fixture\n'],
  [
    'instruments.arch.yaml',
    `version: "1.0.0"
name: Order instruments
parties: []
contexts: []
probes:
  - id: PRB001
    name: Peak load test
    question: "How many orders a minute does checkout take before it errors?"
    source_kind: running system
    status: candidate
    implementation: to-be
`,
  ],
  [
    'delivery.roadmap.yaml',
    `version: "1.0.0"
schemaVersion: "2.8.0"
milestones: []
work_items:
  - id: WI001
    kind: task
    name: "A load test measures peak order throughput"
`,
  ],
  [
    'billing/quality.yaml',
    `version: "1.0.0"
scope: billing
metrics:
  - id: MT100
    name: Invoices issued per day
    type: custom
    unit: count
`,
  ],
  [
    'orders/quality.yaml',
    `version: "1.0.0"
scope: orders
metrics:
  - id: MT100
    name: Orders placed per day
    type: custom
    unit: count
  # no instrument, a planned probe and a work item that builds it
  - id: orders.MT001
    name: Peak orders per minute without errors
    type: throughput
    unit: orders/min
    collection: { status: no-instrument, probe_ref: PRB001, work_item_ref: WI001 }
  # no instrument, a planned probe and no work item
  - id: orders.MT002
    name: Peak payments per minute without errors
    type: throughput
    unit: payments/min
    collection: { status: no-instrument, probe_ref: PRB001 }
  # measured, by a probe no entity declares
  - id: orders.MT003
    name: Order submission latency
    type: latency
    unit: ms
    collection: { status: measured, probe_ref: PRB999 }
  # measured, by an entity that is not a probe
  - id: orders.MT004
    name: Order history latency
    type: latency
    unit: ms
    collection: { status: measured, probe_ref: orders.KPI003 }
  # not measured, by a probe no entity declares
  - id: orders.MT005
    name: Order service uptime
    type: availability
    unit: "%"
    collection: { status: not-measured, probe_ref: PRB999 }
  # no instrument, built by a work item no entity declares
  - id: orders.MT006
    name: Refunds issued per day
    type: custom
    unit: count
    collection: { status: no-instrument, work_item_ref: WI999 }
  # no instrument, built by an entity that is not a work item
  - id: orders.MT007
    name: Returns accepted per day
    type: custom
    unit: count
    collection: { status: no-instrument, work_item_ref: PRB001 }
slos:
  # slo-without-metric: a metric two entities declare -> reported as ambiguous
  - id: orders.SLO001
    name: Orders placed every day
    target: "at least one"
    objective: { comparator: ge, value: 1 }
    metric: MT100
  # slo-without-metric: an objective and a metric no entity declares -> reported once, by this rule only
  - id: orders.SLO002
    name: Order history answers fast
    target: "p95 under 300 ms"
    objective: { comparator: le, value: 300, statistic: p95 }
    metric: orders.MT999
  # slo-without-metric: a metric reference naming a KPI -> reported as not a metric
  - id: orders.SLO003
    name: Order history answers within a second
    target: "p95 under one second"
    objective: { comparator: lt, value: 1000, statistic: p95 }
    metric: orders.KPI003
  # objective-without-measurement (4): a planned probe and a work item
  - id: orders.SLO004
    name: Peak order throughput
    target: "at least 300 orders a minute"
    objective: { comparator: ge, value: 300 }
    metric: orders.MT001
  # objective-without-measurement (4): a planned probe and no work item
  - id: orders.SLO005
    name: Peak payment throughput
    target: "at least 300 payments a minute"
    objective: { comparator: ge, value: 300 }
    metric: orders.MT002
  # objective-without-measurement (2): measured by a probe no entity declares
  - id: orders.SLO006
    name: Order submission within two seconds
    target: "p95 under two seconds"
    objective: { comparator: lt, value: 2000, statistic: p95 }
    metric: orders.MT003
  # objective-without-measurement (2): measured by an entity that is not a probe
  - id: orders.SLO007
    name: Order history within half a second
    target: "p95 under 500 ms"
    objective: { comparator: lt, value: 500, statistic: p95 }
    metric: orders.MT004
  # objective-without-measurement (3): not measured, its probe_ref names no probe
  - id: orders.SLO008
    name: Order service stays up
    target: "99.9% of every month"
    objective: { comparator: ge, value: 99.9 }
    metric: orders.MT005
  # requirement-without-objective: a metric and an objective that is not a comparable level -> reported, saying so
  - id: orders.SLO009
    name: Peak order throughput holds
    target: "at least 300 orders a minute"
    objective: { comparator: above, value: 300 }
    metric: orders.MT001
  # objective-without-measurement (4): its work_item_ref names no entity
  - id: orders.SLO010
    name: Refunds issued every day
    target: "at least one"
    objective: { comparator: ge, value: 1 }
    metric: orders.MT006
  # objective-without-measurement (4): its work_item_ref names a probe
  - id: orders.SLO011
    name: Returns accepted every day
    target: "at least one"
    objective: { comparator: ge, value: 1 }
    metric: orders.MT007
kpis:
  # kpi-without-metric: a metric two entities declare -> reported as ambiguous
  - id: orders.KPI001
    name: Orders placed per day
    target: "more than last month"
    metric: MT100
  # kpi-without-metric: an objective and a metric no entity declares -> reported once, by this rule only
  - id: orders.KPI002
    name: Cancellations within an hour
    target: "under 2%"
    objective: { comparator: lt, value: 2 }
    metric: orders.MT999
  # kpi-without-metric: a metric reference naming an SLO -> reported as not a metric
  - id: orders.KPI003
    name: Order history stays fast
    target: "p95 under 400 ms"
    objective: { comparator: le, value: 400 }
    metric: orders.SLO003
  # requirement-without-objective: a metric and an objective whose value is not a number -> reported, saying so
  - id: orders.KPI004
    name: Peak payments hold
    target: "at least 300 payments a minute"
    objective: { comparator: ge, value: "300" }
    metric: orders.MT002
`,
  ],
]);

const RULES_DIR = fileURLToPath(new URL('./rules', import.meta.url));

function locateRules(): string {
  return RULES_DIR;
}

function checkableModel(fixture: Map<string, string> = FIXTURE) {
  return toCheckableModel(buildBlueprintModel(loadFromMap(fixture).documentsByType));
}

async function issuesOf(ruleId: string, fixture: Map<string, string> = FIXTURE) {
  const rules = await loadRules(locateRules());
  const all = runChecker(checkableModel(fixture), rules, {}, await loadExtensions(rules));
  return all.filter((issue) => issue.ruleId === ruleId);
}

const reportedIds = (issues: Array<{ entityId?: string }>) => issues.map((issue) => issue.entityId).sort();

describe('the fixture', () => {
  it('builds every record it describes', () => {
    const model = checkableModel();
    const count = (type: string) => model.entities.filter((entity) => entity.type === type).length;
    expect([
      count('Metric'),
      count('SLO'),
      count('SLA'),
      count('KPI'),
      count('Security'),
      count('Compliance'),
      count('Resilience'),
      count('FitnessFunction'),
    ]).toEqual([9, 10, 1, 4, 2, 1, 1, 3]);
  });

  it('draws an slo_metric edge for the reference no entity declares, so "a relation exists" would read it as a metric', () => {
    const model = checkableModel();
    const slo = model.entities.find((entity) => entity.displayId === 'orders.SLO003');
    const edges = model.relations.filter((relation) => relation.source === slo?.id && relation.type === 'slo_metric');
    expect(edges).toHaveLength(1);
    const target = model.entities.find((entity) => entity.id === edges[0]?.target);
    expect(target?.type).not.toBe('Metric');
  });
});

describe('slo-without-metric', () => {
  it('reports the SLOs naming no metric and the SLO naming one no entity declares, nothing else', async () => {
    const found = await issuesOf('slo-without-metric');
    expect(reportedIds(found)).toEqual(['orders.SLO002', 'orders.SLO003', 'orders.SLO009']);
    expect(found.every((issue) => issue.severity === 'info')).toBe(true);
  });

  it('says which of the two it is', async () => {
    const found = await issuesOf('slo-without-metric');
    const message = (id: string) => found.find((issue) => issue.entityId === id)?.message ?? '';
    expect(message('orders.SLO002')).toContain('names no metric,');
    expect(message('orders.SLO003')).toContain('names metric "orders.MT999", which is not a metric of the model,');
    expect(message('orders.SLO002')).toContain('Name its metric in `metric`');
  });

});

describe.each([
  ['the orders fixture', FIXTURE],
  ['the references fixture', REFERENCE_FIXTURE],
] as const)('the metric rules over %s', (_label, fixture) => {
  it.each([
    ['SLO', 'slo-without-metric'],
    ['KPI', 'kpi-without-metric'],
  ] as const)('agree with the classification: no reported %s is measurable, and every unreported one has a metric', async (type, ruleId) => {
    const model = checkableModel(fixture);
    const reported = new Set(reportedIds(await issuesOf(ruleId, fixture)));
    const requirements = model.entities.filter((entity) => entity.type === type);
    expect(requirements.length).toBeGreaterThan(2);
    expect(reported.size).toBeGreaterThan(0);
    for (const requirement of requirements) {
      const classification = classifyRequirement(requirement, model);
      const lacksMetric = classification?.remedy === 'metric' || classification?.remedy === 'metric-and-objective';
      expect(reported.has(requirement.displayId ?? '')).toBe(lacksMetric);
    }
  });
});

describe('kpi-without-metric', () => {
  it('reports the KPI naming no metric only', async () => {
    const found = await issuesOf('kpi-without-metric');
    expect(reportedIds(found)).toEqual(['orders.KPI002']);
    expect(found[0]?.severity).toBe('info');
    expect(found[0]?.message).toContain('KPI "orders.KPI002" (Orders placed per day) names no metric,');
  });
});

describe('requirement-confirmed-without-evidence', () => {
  it('reports each confirmed requirement that cites no evidence, of every shape, and a constraint fitness function', async () => {
    const found = await issuesOf('requirement-confirmed-without-evidence');
    expect(reportedIds(found)).toEqual([
      'orders.FF001',
      'orders.KPI001',
      'orders.MT001',
      'orders.SEC002',
      'orders.SLA001',
    ]);
    expect(found.every((issue) => issue.severity === 'warn')).toBe(true);
  });

  it('leaves out a guard fitness function, another certainty, a committed stage without certainty and a sourced claim', async () => {
    const reported = new Set(reportedIds(await issuesOf('requirement-confirmed-without-evidence')));
    for (const id of ['orders.FF002', 'orders.MT002', 'orders.CMP001', 'orders.SLO001', 'orders.SEC001']) {
      expect(reported.has(id)).toBe(false);
    }
  });

  it('names the type and both fixes', async () => {
    const found = await issuesOf('requirement-confirmed-without-evidence');
    const message = found.find((issue) => issue.entityId === 'orders.SEC002')?.message ?? '';
    expect(message).toContain('Security requirement "orders.SEC002" (Order ownership authorization) is marked certainty: confirmed');
    expect(message).toContain('provenance.evidence');
    expect(message).toContain('probable or speculative');
    const constraint = found.find((issue) => issue.entityId === 'orders.FF001')?.message ?? '';
    expect(constraint).toMatch(/^Fitness function "orders.FF001"/);
  });
});

describe('requirement-unverified', () => {
  it('reports every SLO, KPI, security, compliance and resilience requirement no fitness function verifies', async () => {
    const found = await issuesOf('requirement-unverified');
    expect(reportedIds(found)).toEqual([
      'orders.KPI002',
      'orders.KPI003',
      'orders.KPI004',
      'orders.RES001',
      'orders.SEC002',
      'orders.SLO002',
      'orders.SLO003',
      'orders.SLO004',
      'orders.SLO005',
      'orders.SLO006',
      'orders.SLO007',
      'orders.SLO008',
      'orders.SLO009',
      'orders.SLO010',
    ]);
    expect(found.every((issue) => issue.severity === 'info')).toBe(true);
  });

  it('is silent for what a fitness function verifies, through any arm', async () => {
    const reported = new Set(reportedIds(await issuesOf('requirement-unverified')));
    for (const id of ['orders.SLO001', 'orders.KPI001', 'orders.SEC001', 'orders.CMP001']) {
      expect(reported.has(id)).toBe(false);
    }
  });

  it('never reports a fitness function, a constraint included, nor an SLA or a metric', async () => {
    const model = checkableModel();
    const typeOf = new Map(model.entities.map((entity) => [entity.displayId, entity.type]));
    const types = new Set(reportedIds(await issuesOf('requirement-unverified')).map((id) => typeOf.get(id ?? '')));
    expect([...types].sort()).toEqual(['KPI', 'Resilience', 'SLO', 'Security']);
  });

  it('does not count an incoming relation of another type as a guard', async () => {
    const model = checkableModel();
    const slo = model.entities.find((entity) => entity.displayId === 'orders.SLO002');
    expect(model.relations.some((relation) => relation.target === slo?.id && relation.type === 'sla_slo')).toBe(true);
    expect(reportedIds(await issuesOf('requirement-unverified'))).toContain('orders.SLO002');
  });

  it('names the list a guard would go in', async () => {
    const found = await issuesOf('requirement-unverified');
    const message = (id: string) => found.find((issue) => issue.entityId === id)?.message ?? '';
    expect(message('orders.RES001')).toContain('Resilience requirement "orders.RES001" (Order service availability) is verified by no fitness function');
    expect(message('orders.RES001')).toContain('verifies.resilience');
    expect(message('orders.SEC002')).toContain('verifies.security');
    expect(message('orders.KPI002')).toContain('verifies.kpis');
    expect(message('orders.SLO002')).toContain('verifies.slos');
  });
});

describe('objective-without-measurement', () => {
  const messageOf = async (id: string) =>
    (await issuesOf('objective-without-measurement')).find((issue) => issue.entityId === id)?.message ?? '';

  it('reports each requirement with an objective whose metric is not measured by a named instrument, once', async () => {
    const found = await issuesOf('objective-without-measurement');
    expect(reportedIds(found)).toEqual([
      'orders.KPI003',
      'orders.KPI004',
      'orders.SLO004',
      'orders.SLO006',
      'orders.SLO007',
      'orders.SLO008',
    ]);
    expect(found.every((issue) => issue.severity === 'info')).toBe(true);
  });

  it('(1) a metric that states no status: not stated, never read as measured', async () => {
    expect(await messageOf('orders.SLO004')).toBe(
      'SLO "orders.SLO004" (Order history stays fast) states an objective, but its metric "orders.MT003" does not say whether it is measured: state measured, not-measured or no-instrument in collection.status.',
    );
  });

  it('measured with a probe and results: nothing to report', async () => {
    expect(await messageOf('orders.SLO005')).toBe('');
  });

  it('(2) measured with no probe, a one-off analysis included', async () => {
    expect(await messageOf('orders.SLO006')).toBe(
      'SLO "orders.SLO006" (Calls into the legacy module never rise) states an objective on metric "orders.MT005", which is stated as measured but names no instrument: name the probe that produces its results in collection.probe_ref.',
    );
  });

  it('(3) not measured: a gap in the model, naming the probe only when one is referenced, and the fields that clear it', async () => {
    expect(await messageOf('orders.SLO007')).toBe(
      'SLO "orders.SLO007" (Order service stays up) states an objective on metric "orders.MT006", which is stated as not measured: a gap in the model. Start measuring it with probe "PRB001", then state measured in collection.status and where the results are kept in collection.results_location.',
    );
    expect(await messageOf('orders.KPI003')).toBe(
      'KPI "orders.KPI003" (Cancellations within an hour) states an objective on metric "orders.MT007", which is stated as not measured: a gap in the model. Start measuring it, then state measured in collection.status, the probe that measures it in collection.probe_ref and where the results are kept in collection.results_location.',
    );
  });

  it('(4) no instrument: an instrument need, naming the work item that builds it or the field that would name one', async () => {
    expect(await messageOf('orders.KPI004')).toBe(
      'KPI "orders.KPI004" (Peak order throughput) states an objective on metric "orders.MT008", which has no measuring instrument: build or acquire one; work item "WI001" builds it.',
    );
    expect(await messageOf('orders.SLO008')).toBe(
      'SLO "orders.SLO008" (Confirmation mail within a minute) states an objective on metric "orders.MT009", which has no measuring instrument: build or acquire one; no work item builds it: name one in collection.work_item_ref.',
    );
  });

  it('leaves an objective without a metric to slo-without-metric, so it is reported once', async () => {
    expect(await messageOf('orders.SLO009')).toBe('');
    expect(reportedIds(await issuesOf('slo-without-metric'))).toContain('orders.SLO009');
  });

  it('leaves a requirement without an objective alone, whatever its metric states', async () => {
    expect(await messageOf('orders.SLO010')).toBe('');
  });

  it('reports only requirements the classification calls measurable', async () => {
    const model = checkableModel();
    const reported = reportedIds(await issuesOf('objective-without-measurement'));
    for (const id of reported) {
      const entity = model.entities.find((candidate) => candidate.displayId === id);
      expect(classifyRequirement(entity!, model)?.class).toBe('measurable');
    }
  });
});

describe('the metric rules over references that link nothing', () => {
  const messagesOf = async (ruleId: string) =>
    Object.fromEntries((await issuesOf(ruleId, REFERENCE_FIXTURE)).map((issue) => [issue.entityId, issue.message]));

  it('the fixture holds an ambiguous placeholder for MT100 with both declarations as candidates', () => {
    const model = checkableModel(REFERENCE_FIXTURE);
    const placeholder = model.entities.find((entity) => entity.type === 'Missing' && entity.displayId === 'MT100');
    expect(placeholder?.data).toMatchObject({ ambiguous: true });
    expect((placeholder?.data as { candidates?: string[] })?.candidates).toHaveLength(2);
    expect(model.entities.filter((entity) => entity.type === 'Metric' && entity.displayId === 'MT100')).toHaveLength(2);
  });

  it('reports an ambiguous, a dangling and a wrong-type SLO metric, each saying which', async () => {
    expect(await messagesOf('slo-without-metric')).toEqual({
      'orders.SLO001':
        'SLO "orders.SLO001" (Orders placed every day) names metric "MT100", which 2 entities of the model declare, so it names none of them and the model does not say what is measured to judge it. Give the metric it means an id no other entity declares, for example with its slice as a scope prefix, then name that id in `metric`.',
      'orders.SLO002':
        'SLO "orders.SLO002" (Order history answers fast) names metric "orders.MT999", which is not a metric of the model, so the model does not say what is measured to judge it. Name its metric in `metric`; with an `objective` beside it the SLO is measurable.',
      'orders.SLO003':
        'SLO "orders.SLO003" (Order history answers within a second) names metric "orders.KPI003", which is not a metric of the model, so the model does not say what is measured to judge it. Name its metric in `metric`; with an `objective` beside it the SLO is measurable.',
    });
  });

  it('reports an ambiguous, a dangling and a wrong-type KPI metric, each saying which', async () => {
    expect(await messagesOf('kpi-without-metric')).toEqual({
      'orders.KPI001':
        'KPI "orders.KPI001" (Orders placed per day) names metric "MT100", which 2 entities of the model declare, so it names none of them and the model does not say what is measured to judge it. Give the metric it means an id no other entity declares, for example with its slice as a scope prefix, then name that id in `metric`.',
      'orders.KPI002':
        'KPI "orders.KPI002" (Cancellations within an hour) names metric "orders.MT999", which is not a metric of the model, so the model does not say what is measured to judge it. Name its metric in `metric`; with an `objective` beside it the KPI is measurable.',
      'orders.KPI003':
        'KPI "orders.KPI003" (Order history stays fast) names metric "orders.SLO003", which is not a metric of the model, so the model does not say what is measured to judge it. Name its metric in `metric`; with an `objective` beside it the KPI is measurable.',
    });
  });

  it('reports an objective on a metric that does not resolve once, by the metric rule only', async () => {
    const objectives = new Set(reportedIds(await issuesOf('objective-without-measurement', REFERENCE_FIXTURE)));
    for (const id of ['orders.SLO001', 'orders.SLO002', 'orders.SLO003', 'orders.KPI002', 'orders.KPI003']) {
      expect(objectives.has(id)).toBe(false);
    }
    expect(reportedIds(await issuesOf('slo-without-metric', REFERENCE_FIXTURE))).toContain('orders.SLO002');
    expect(reportedIds(await issuesOf('kpi-without-metric', REFERENCE_FIXTURE))).toContain('orders.KPI002');
  });
});

describe('objective-without-measurement over probe references', () => {
  const messagesOf = async () =>
    Object.fromEntries(
      (await issuesOf('objective-without-measurement', REFERENCE_FIXTURE)).map((issue) => [issue.entityId, issue.message]),
    );

  it('(4) names the probe the metric plans beside the work item, or the field that would name one', async () => {
    const messages = await messagesOf();
    expect(messages['orders.SLO004']).toBe(
      'SLO "orders.SLO004" (Peak order throughput) states an objective on metric "orders.MT001", which has no measuring instrument: build or acquire probe "PRB001", the instrument it names; work item "WI001" builds it.',
    );
    expect(messages['orders.SLO005']).toBe(
      'SLO "orders.SLO005" (Peak payment throughput) states an objective on metric "orders.MT002", which has no measuring instrument: build or acquire probe "PRB001", the instrument it names; no work item builds it: name one in collection.work_item_ref.',
    );
  });

  it('(2) a measured metric whose probe_ref names no probe is reported, saying the reference names none', async () => {
    const messages = await messagesOf();
    expect(messages['orders.SLO006']).toBe(
      'SLO "orders.SLO006" (Order submission within two seconds) states an objective on metric "orders.MT003", which is stated as measured, but its probe_ref "PRB999" names no single probe of the model: name the probe that produces its results in collection.probe_ref.',
    );
    expect(messages['orders.SLO007']).toBe(
      'SLO "orders.SLO007" (Order history within half a second) states an objective on metric "orders.MT004", which is stated as measured, but its probe_ref "orders.KPI003" names no single probe of the model: name the probe that produces its results in collection.probe_ref.',
    );
  });

  it('(3) a not-measured metric whose probe_ref names no probe is told to name one', async () => {
    expect((await messagesOf())['orders.SLO008']).toBe(
      'SLO "orders.SLO008" (Order service stays up) states an objective on metric "orders.MT005", which is stated as not measured: a gap in the model. Start measuring it, then state measured in collection.status, the probe that measures it in collection.probe_ref and where the results are kept in collection.results_location.',
    );
  });

  it('(4) a work_item_ref that names no single work item is reported as naming none, not as a work item that builds it', async () => {
    const messages = await messagesOf();
    expect(messages['orders.SLO010']).toBe(
      'SLO "orders.SLO010" (Refunds issued every day) states an objective on metric "orders.MT006", which has no measuring instrument: build or acquire one; its work_item_ref "WI999" names no single work item of the model: name the work item that builds it in collection.work_item_ref.',
    );
    expect(messages['orders.SLO011']).toBe(
      'SLO "orders.SLO011" (Returns accepted every day) states an objective on metric "orders.MT007", which has no measuring instrument: build or acquire one; its work_item_ref "PRB001" names no single work item of the model: name the work item that builds it in collection.work_item_ref.',
    );
  });

  it('reports exactly the requirements whose metric resolves and states no instrument of the model', async () => {
    expect(Object.keys(await messagesOf()).sort()).toEqual([
      'orders.SLO004',
      'orders.SLO005',
      'orders.SLO006',
      'orders.SLO007',
      'orders.SLO008',
      'orders.SLO010',
      'orders.SLO011',
    ]);
  });
});

describe('requirement-without-objective', () => {
  const messagesOf = async (fixture: Map<string, string> = FIXTURE) =>
    Object.fromEntries(
      (await issuesOf('requirement-without-objective', fixture)).map((issue) => [issue.entityId, issue.message]),
    );

  it('reports each SLO and KPI that names a metric of the model and states no objective, nothing else', async () => {
    const found = await issuesOf('requirement-without-objective');
    expect(reportedIds(found)).toEqual(['orders.KPI001', 'orders.SLO001', 'orders.SLO010']);
    expect(found.every((issue) => issue.severity === 'info')).toBe(true);
  });

  it('names the requirement, its metric, what is missing and the fields that clear it', async () => {
    expect((await messagesOf())['orders.SLO010']).toBe(
      'SLO "orders.SLO010" (Order history rarely times out) names metric "orders.MT003" and states no objective, so no result of the metric can be compared with a level it requires. State one in objective: comparator (lt, le, gt, ge or eq), value (a number in the unit of the metric) and, optionally, statistic (for example p95).',
    );
    expect((await messagesOf())['orders.KPI001']).toMatch(/^KPI "orders\.KPI001" \(Order submission success rate\) names metric "orders\.MT002" and states no objective,/);
  });

  it('says when the objective stated is not a comparable level, an unknown comparator or a value that is not a number', async () => {
    const messages = await messagesOf(REFERENCE_FIXTURE);
    expect(Object.keys(messages).sort()).toEqual(['orders.KPI004', 'orders.SLO009']);
    expect(messages['orders.SLO009']).toBe(
      'SLO "orders.SLO009" (Peak order throughput holds) names metric "orders.MT001" and states an objective that is not a comparable level, so no result of the metric can be compared with it. Correct it: objective.comparator is one of lt, le, gt, ge or eq, and objective.value is a number in the unit of the metric.',
    );
    expect(messages['orders.KPI004']).toContain('KPI "orders.KPI004" (Peak payments hold) names metric "orders.MT002" and states an objective that is not a comparable level');
  });

  it('leaves a requirement with no metric to the metric rules, and a measurable one to objective-without-measurement', async () => {
    const reported = new Set(reportedIds(await issuesOf('requirement-without-objective')));
    for (const id of ['orders.SLO002', 'orders.SLO003', 'orders.SLO009', 'orders.KPI002']) expect(reported.has(id)).toBe(false);
    for (const id of ['orders.SLO004', 'orders.SLO005', 'orders.SLO006', 'orders.KPI003', 'orders.KPI004']) expect(reported.has(id)).toBe(false);
  });

  it.each([
    ['the orders fixture', FIXTURE],
    ['the references fixture', REFERENCE_FIXTURE],
  ] as const)('agrees with the classification over %s: reported exactly where the remedy is an objective', async (_label, fixture) => {
    const model = checkableModel(fixture);
    const reported = new Set(reportedIds(await issuesOf('requirement-without-objective', fixture)));
    const requirements = model.entities.filter((entity) => entity.type === 'SLO' || entity.type === 'KPI');
    expect(reported.size).toBeGreaterThan(1);
    for (const requirement of requirements) {
      expect(reported.has(requirement.displayId ?? '')).toBe(classifyRequirement(requirement, model)?.remedy === 'objective');
    }
  });

  it('never reports a requirement another NFR metric or objective rule reports', async () => {
    for (const fixture of [FIXTURE, REFERENCE_FIXTURE]) {
      const mine = new Set(reportedIds(await issuesOf('requirement-without-objective', fixture)));
      for (const other of ['slo-without-metric', 'kpi-without-metric', 'objective-without-measurement']) {
        for (const id of reportedIds(await issuesOf(other, fixture))) expect(mine.has(id)).toBe(false);
      }
    }
  });
});

describe('the NFR rule files', () => {
  const NFR_RULES = [
    'slo-without-metric',
    'kpi-without-metric',
    'requirement-confirmed-without-evidence',
    'requirement-unverified',
    'objective-without-measurement',
    'requirement-without-objective',
  ];

  it('ship at advisory severities only', async () => {
    const rules = await loadRules(locateRules());
    const severities = Object.fromEntries(
      rules.filter((rule) => NFR_RULES.includes(rule.id)).map((rule) => [rule.id, rule.severity]),
    );
    expect(severities).toEqual({
      'slo-without-metric': 'info',
      'kpi-without-metric': 'info',
      'requirement-confirmed-without-evidence': 'warn',
      'requirement-unverified': 'info',
      'objective-without-measurement': 'info',
      'requirement-without-objective': 'info',
    });
  });
});
