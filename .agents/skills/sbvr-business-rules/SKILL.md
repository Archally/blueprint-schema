---
name: sbvr-business-rules
description: >
  Use when modeling business rules, invariants, constraints, and state transitions in an Archally
  blueprint using SBVR semantics - choosing rule type (structural/operative) and deontic modality
  (necessary/obligatory/prohibited/permitted), writing fact-oriented logic, and wiring rules to
  operations (governed_by) and concepts. Maps to rules.yaml and domain.yaml governed_by.
---

# SBVR Business Rules for Blueprints

SBVR (Semantics of Business Vocabulary and Rules) distinguishes **structural rules** (definitions
of how the business *is* - cannot be violated, only mis-modeled) from **operative rules** (rules
of *conduct* - can be violated, so the system enforces them). Express both fact-orientedly over
the ubiquitous vocabulary (the `concepts`).

## Rule types → `rules.yaml` sections + ID prefix

| Section | Prefix | Use for |
|---|---|---|
| `structural` | `SR` | Invariants / definitional truths ("an order line belongs to exactly one order"). |
| `validation` | `VR` | Operative checks enforced on operations ("deadline must be in the future"). |
| `classification` | `CR` | Categorization / derivation of type ("a product with combinations is 'configurable'"). |
| `derivation` | `DR` | Derived values ("order total = sum of lines"). |
| `equivalence` | `EQ` | Definitional equivalence between terms. |
| `transition` | `TR` | State-machine transitions (own `concept`, `from`, `to`, `guard`). |

## Modality (`modality`)

| Modality | Meaning | Use for |
|---|---|---|
| `necessary` | Must always hold (structural) | Data integrity / definitional truth |
| `obligatory` | System must enforce (operative) | Validation the business requires |
| `prohibited` | Must never happen | Security / safety constraints |
| `permitted` | Explicitly allowed | Optional behavior, exceptions |

`rules.certainty` is **separate** and means `definitive` vs `heuristic` (whether the rule is
absolute or probabilistic - heuristic rules may yield false positives). Don't confuse it with the
epistemic `provenance.certainty`.

## Writing a rule
```yaml
structural:
  - id: SR010
    name: "Order line is bound to one order and one product"
    description: "…"
    logic: { then: "orderLine.orderId != null AND orderLine.productId != null" }
    modality: necessary
    concepts: [checkout.CN006]             # rule references the concepts it governs
    code_refs: [{ path: …, role: validation }]
```
- `logic` is `{ when?, then }` - fact-oriented, business language; optional in Phase 1 (sketch
  with name + description, fill logic later).
- **Single direction of truth:** the rule references its `concepts`; do not back-reference the
  rule from the concept (except optional `concept.transition_rules` for TR).
- Operations link rules via `governed_by: [{ rule: SR010 }]` (rule_ref only - **TR transitions are
  not valid in `governed_by`**; transitions live in `rules.yaml` referencing the concept's states).

## Transitions (TR)
A `transition` needs `id`, `name`, `concept`, `from`, `to` - and `from`/`to` **must be states
declared on that concept's `states[]`**. Optional `guard.when`, `modality`. The concept's
`enumeration` `transitions_to` is the convenience view; the TR rule is authoritative.

## Coverage
Every rule should have ≥1 test (`test-cases.validates.rules`) - untested rules are AP37. A happy
path test confirms the rule passes; an edge/error case confirms it's enforced.

## Brownfield notes
- Legacy validation is scattered (attributes, service guards, DB constraints, UI). Model the
  *business rule* once and `code_refs` the several places it's enforced (N:M).
- If a rule is inferred but you haven't found its enforcement in code, set
  `provenance.certainty: probable` (or `exploring`) with an `assumption` evidence note, or raise a
  `QN`. Don't assert invented invariants as `confirmed`.

## Anti-patterns
- Implementation-flavored logic ("set IsValid=1") instead of fact-oriented business statements.
- Rules with no `concepts` (orphans) or no tests (AP37).
- Putting a transition rule in `governed_by` (use a VR/SR there; TR is referenced by the concept).
