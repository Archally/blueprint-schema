import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';
import { loadFromMap, buildBlueprintModel } from '@archally/blueprint-schema/model';
import { toCheckableModel } from './adapter.js';

// v2.7.6 (D15/D17/step-12 Slice 4) — end-to-end resolvability parity:
// the PUBLIC model-builder must materialize the `handled_by`/`scoped_to` membership edges,
// and the PUBLIC declarative rules (`unbound-operation.yaml`/`unbound-question.yaml`) must
// flag exactly the entities with NO such edge. This exercises the whole public pipeline
// (loadFromMap → buildBlueprintModel → toCheckableModel → runChecker), the same path the CLI
// uses — so it is the cross-stack parity gate: the unbound set the public rule reports equals
// the unbound set the monorepo `findMembershipGaps` reports on the same model (identical
// `membership.ts` derivation, identical loader markers).

const RULES_DIR = fileURLToPath(new URL('./rules', import.meta.url));

// Fixture: one context (Orders) whose contract EXPOSES CMD001 (→ bound), plus a `misc/` slice
// whose op/question match no context by name/scope and are referenced by no contract (→ unbound).
const FILES = new Map<string, string>([
  [
    'orders/arch.yaml',
    `parties:
  - name: Shop
    contexts:
      - name: Orders
        services:
          - name: OrderService
            contracts:
              openapi:
                expose:
                  - orders.CMD001
`,
  ],
  [
    'orders/domain.yaml',
    `name: Orders
operations:
  - id: CMD001
    name: PlaceOrder
    kind: command
questions:
  - id: QN001
    name: What makes an order valid?
    bounded_context_ref: Orders
`,
  ],
  [
    'misc/domain.yaml',
    `name: Nowhere
operations:
  - id: CMD099
    name: OrphanOp
    kind: command
questions:
  - id: QN099
    name: Which context owns this?
`,
  ],
]);

describe('resolvability parity — unbound-operation / unbound-question over materialized edges', () => {
  const builtModel = buildBlueprintModel(loadFromMap(FILES).documentsByType);

  it('the public model-builder materializes handled_by / scoped_to edges', () => {
    const handledBy = builtModel.relations.filter((r) => r.type === 'handled_by');
    const scopedTo = builtModel.relations.filter((r) => r.type === 'scoped_to');
    // CMD001 bound via contract-expose; QN001 bound via bounded_context_ref (loose name shim).
    expect(handledBy.length).toBeGreaterThanOrEqual(1);
    expect(scopedTo.length).toBeGreaterThanOrEqual(1);
  });

  it('the rules flag exactly the entities with no membership edge', async () => {
    const model = toCheckableModel(builtModel);
    const rules = await loadRules(RULES_DIR);
    const issues = runChecker(model, rules, {}, await loadExtensions(rules));

    const unboundOps = issues.filter((i) => i.ruleId === 'unbound-operation');
    const unboundQuestions = issues.filter((i) => i.ruleId === 'unbound-question');

    // CMD099 is unbound (no contract, no name/scope match); CMD001 is bound (contract-exposed).
    expect(unboundOps).toHaveLength(1);
    expect(unboundOps[0]!.severity).toBe('warn');
    expect(unboundOps[0]!.message).toContain('CMD099');
    expect(unboundOps.some((i) => i.message.includes('CMD001'))).toBe(false);

    // QN099 is unbound (no ref, no name/scope match); QN001 is bound (bounded_context_ref: Orders).
    expect(unboundQuestions).toHaveLength(1);
    expect(unboundQuestions[0]!.severity).toBe('warn');
    expect(unboundQuestions[0]!.message).toContain('QN099');
    expect(unboundQuestions.some((i) => i.message.includes('QN001'))).toBe(false);
  });
});
