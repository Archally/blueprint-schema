import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';
import { loadFromMap, buildBlueprintModel } from '@archally/blueprint-schema/model';
import { toCheckableModel } from './adapter.js';

/**
 * The five quality-adjacent rules added in the 2026-07-26 wave, exercised end-to-end through the
 * PUBLIC pipeline (`loadFromMap` → `buildBlueprintModel` → `toCheckableModel` → `runChecker`)
 * against the ported rule pack.
 *
 * `FIXTURE` below is byte-identical to the monorepo's
 * `servers/blueprint/cli/src/semantic/new-quality-rules.test.ts` — that is the whole point. Same
 * YAML, two independently-built model builders, two adapters, one rule pack: the finding sets must
 * agree. If they ever diverge, one rule means two different things depending on which stack ran it,
 * which is the divergence the shared pack exists to end. Do not edit the fixture here; edit the
 * canonical test and re-port.
 *
 * Every rule gets a violator AND a compliant sibling — coverage without the negative case cannot
 * distinguish "the rule works" from "the rule fires on everything".
 */

const FIXTURE = new Map<string, string>([
  [
    'lending/domain.yaml',
    `name: Lending
operations:
  - id: EVT001
    name: LoanRefused
    kind: event
  - id: EVT002
    name: LoanIssued
    kind: event
    description: A copy has been handed to the borrower and the loan clock has started.
  - id: EVT003
    name: HoldPlaced
    kind: event
    summary: A borrower has joined the queue for a title that is currently out.
`,
  ],
  [
    'lending/models.yaml',
    `version: "1.0.0"
scope: lending
components:
  schemas:
    BareLoanPayload:
      x-model-id: MDL001
      type: object
      description: Deliberately carries neither purpose nor represents.
      properties:
        loanId:
          type: string
          description: The loan identifier.
    GoodLoanPayload:
      x-model-id: MDL002
      purpose: command-payload
      type: object
      description: Request body for issuing a loan.
      represents:
        - concept: lending.CN001
          kind: api
      properties:
        loanId:
          type: string
          description: The loan identifier.
`,
  ],
  [
    'lending/story.yaml',
    `version: "1.0.0"
scope: lending
user_stories:
  - id: US001
    actor: lending.ACT001
    goal: place a hold on a title that is out
    benefit: I get it as soon as it comes back
  - id: US002
    actor: lending.ACT001
    goal: see my current loans
    benefit: I know what is due when
    acceptance_criteria:
      - Active loans listed with due dates
      - Overdue loans visually distinguished
`,
  ],
  [
    'lending/decisions.yaml',
    `version: "1.0.0"
scope: lending
decisions:
  - id: D001
    title: Holds are queued FIFO
    summary: First-come-first-served queue for held titles.
    certainty: confirmed
  - id: D002
    title: Fines accrue daily
    summary: Overdue fines are charged per day, not per week.
    certainty: confirmed
    evidence:
      - kind: stakeholder-signoff
        summary: Confirmed with the circulation desk lead.
  - id: D003
    title: Self-service kiosks may replace the desk
    summary: Unproven direction, recorded to keep the option visible.
    certainty: speculative
`,
  ],
]);

const RULES_DIR = fileURLToPath(new URL('./rules', import.meta.url));

async function findingsFor(ruleId: string): Promise<string[]> {
  const built = buildBlueprintModel(loadFromMap(FIXTURE).documentsByType);
  const rules = await loadRules(RULES_DIR);
  const issues = runChecker(toCheckableModel(built), rules, {}, await loadExtensions(rules));
  return issues.filter((issue) => issue.ruleId === ruleId).map((issue) => issue.message);
}

describe('undescribed-event', () => {
  it('fires on the bare event and not on description or summary siblings', async () => {
    const messages = await findingsFor('undescribed-event');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('EVT001');
  });

  it('accepts `summary` as prose', async () => {
    // EVT003 carries only `summary`. Several models author events that way and are complete;
    // treating description as the only acceptable field would make them all false positives.
    const messages = await findingsFor('undescribed-event');
    expect(messages.some((message) => message.includes('EVT003'))).toBe(false);
  });
});

describe('decision-asserted-without-evidence', () => {
  it('fires only on a confirmed decision citing nothing', async () => {
    const messages = await findingsFor('decision-asserted-without-evidence');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('D001');
  });

  it('is silent on a confirmed decision WITH evidence', async () => {
    const messages = await findingsFor('decision-asserted-without-evidence');
    expect(messages.some((message) => message.includes('D002'))).toBe(false);
  });

  it('is silent on a speculative decision with no evidence', async () => {
    // The deliberate narrowing: `speculative` makes no evidentiary claim, so citing nothing is
    // honest rather than defective. A rule that flagged D003 would punish hypothesis-tracking.
    const messages = await findingsFor('decision-asserted-without-evidence');
    expect(messages.some((message) => message.includes('D003'))).toBe(false);
  });
});

describe('user-story-without-acceptance-criteria', () => {
  it('fires on the criteria-less story only', async () => {
    const messages = await findingsFor('user-story-without-acceptance-criteria');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('US001');
  });
});

describe('model-without-purpose / model-without-represents', () => {
  it('both fire on the bare model and neither on the complete one', async () => {
    const withoutPurpose = await findingsFor('model-without-purpose');
    const withoutRepresents = await findingsFor('model-without-represents');

    expect(withoutPurpose).toHaveLength(1);
    expect(withoutPurpose[0]).toContain('MDL001');
    expect(withoutRepresents).toHaveLength(1);
    expect(withoutRepresents[0]).toContain('MDL001');

    expect(withoutPurpose.some((message) => message.includes('MDL002'))).toBe(false);
    expect(withoutRepresents.some((message) => message.includes('MDL002'))).toBe(false);
  });
});

describe('severities', () => {
  it('ships as 2 warn + 3 info — these rules must not gate a default run', async () => {
    const rules = await loadRules(RULES_DIR);
    const added = new Map(rules
      .filter((rule) => [
        'undescribed-event',
        'decision-asserted-without-evidence',
        'user-story-without-acceptance-criteria',
        'model-without-purpose',
        'model-without-represents',
      ].includes(rule.id))
      .map((rule) => [rule.id, rule.severity]));

    expect(added.size).toBe(5);
    expect([...added.values()].filter((severity) => severity === 'warn')).toHaveLength(2);
    expect([...added.values()].filter((severity) => severity === 'info')).toHaveLength(3);
    expect([...added.values()].some((severity) => severity === 'error')).toBe(false);
  });
});
