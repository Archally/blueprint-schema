# Blueprint Modeling Guide

How to build effective blueprints — from a blank directory to a comprehensive system model.

## Core Philosophy

**MVB-first, not completeness-first.** Never build everything at once. Capture intent, identify the skeleton, produce a Minimal Viable Blueprint (5-20 entities), validate it, then grow iteratively. A focused model that validates cleanly is more useful than a comprehensive model full of gaps and broken references.

**Single authoritative location.** Every fact has exactly one source. Redundant data is a convenience view, not a second source of truth:

| Fact | Authoritative source | Convenience view |
|------|---------------------|-----------------|
| Causal links (what produces what) | `domain.yaml` (produces/reacts_to) | `story.yaml` steps |
| Data shapes | `models.yaml` | — |
| Ownership hierarchy | `organization.yaml` | `owned_by` on entities |
| State transitions | `rules.yaml` (transition rules) | `concepts.yaml` enumeration transitions_to |

**Single direction of truth.** Every cross-file reference has exactly one owner. The owner contains the link; the target never back-references. For example, `domain.yaml` owns `governed_by: [SR001]` — `rules.yaml` does NOT back-reference to the operation.

**Search before you mint.** The model is cumulative: every slice deepens knowledge of the *whole* system, so a new slice routinely re-encounters something an earlier slice already modeled. A duplicate entity is the one defect no gate catches — it is legal YAML, it validates, it passes the semantic checker, and it surfaces months later as two half-modeled versions of one idea.

| Before adding | Search |
|---|---|
| goal, risk, trade-off | root `motivation.yaml` and every `*.motivation.yaml` |
| decision | every `*.decisions.yaml` |
| business rule | every `*.rules.yaml` |
| concept, actor, shared-kernel type | every `*.concepts.yaml` |
| capability | `capability.yaml` |

```bash
npm run build && node tools/model-builder/dist/cli.js .blueprint/v2.8 --output model.json
node tools/entity-query/cli.mjs model.json --text "discount"
```

Then choose deliberately:

- **It already exists** → reference it (`{slice}.ID`, or a bare root ID). Do not re-create it.
- **Your slice extends it** → update the existing entity (broaden the risk, add an `evidence` record, generalize the rule). Record what changed in `provenance`/`evidence` so the evolution stays traceable.
- **A slice-local entity turns out to be systemic** (a second slice hits the same concern) → promote it to root and repoint the references, rather than cloning it per slice.
- **Genuinely a different concern** → create it. Forced reuse is worse than a second entity.

A slice-local risk may legitimately *also* roll up into a systemic root risk. Link both; do not restate the systemic one in every slice.

## Phases

### Phase 0 — Knowledge Analysis (existing systems only)

When modeling an existing codebase, analyze before modeling:

1. **Enumerate domain aggregates** from code directories and top-level classes
2. **Assign DDD roles** using behavioral signals (see [Decision Trees](#decision-trees))
3. **Group CRUD variants** into semantic operations — `Add/Edit/Delete X` becomes 3 operations, not 6
4. **Map source files** to identify which code implements which domain concept

The code is the source of truth for the design plane. Specifications describe intent; code describes reality. Never model design-plane entities from specs alone.

### Phase 1 — Minimal Viable Blueprint

Per business domain (slice), construct in this order:

1. **concepts.yaml** — Aggregate roots with `stereotype: aggregate-root`, 2-3 key attributes (CAT### IDs)
2. **motivation.yaml** — 1-2 goals, 1-2 risks
3. **rules.yaml** — 1-2 critical rules per aggregate
4. **domain.yaml** — Primary command→event causal chains (happy path only)
5. **story.yaml** — 1 story per slice + user stories with delivery priority
6. **test-cases.yaml** — 1 happy path test per key operation

**Phase 1 explicitly defers:** value objects, error catalog, models, decisions, UI, org, quality, dynamics, capabilities, value streams, milestones.

### Phase 2 — Detail Extension

- Value objects, entities within aggregates, additional attributes
- Error catalog (ERR###) with category, severity, http_status
- Data models (MDL###) with `purpose` and `represents[]`
- Decisions (D###) with `declared_impact`
- Questions (QN###) — domain knowledge requirements
- Use cases (UC###) with scenarios
- Personas on actors
- `code_refs` linking entities to source files
- `materializes[]` on operations for entity lifecycle effects

### Phase 3 — Governance and Architecture

- Architecture services with contracts (openapi/asyncapi/graphql)
- Quality metrics, KPIs, SLOs
- UI screens, actions, navigation
- Organizational hierarchy (parties, departments, teams)
- `owned_by` across all schema files
- Milestones with deliverables and success criteria
- Value streams with stages and capabilities
- Business capability map
- Risk enrichment (contingency, owner, status)

### Phase 4+ — Dynamics and Evolution

- Parallelism, ordering, race conditions
- Fitness functions
- Migration files for model evolution
- Complete test coverage

## Decision Trees

### Is it an Aggregate Root or a Child Entity?

1. Does it have its own typed ID in the codebase? → NO → **Value Object**
2. Does it have independent commands (own Command/ directory)? → YES → **Aggregate Root**
3. Can it be created/deleted independently of a parent? → YES → **Aggregate Root**
4. Is it referenced from outside its parent context? → YES → **Aggregate Root**
5. Otherwise → **Child Entity** (stereotype: entity)

### One Domain Slice or Two?

1. Do the entities share the same ubiquitous language? → YES → Same slice
2. Do they have different lifecycle rates? → YES → Different slices
3. Are they owned by different teams? → YES → **Different slices** (strongest signal)
4. Do they have different data consistency needs? → YES → Different slices
5. Signals conflict? → Favor team ownership boundary

Note: this decision tree determines filesystem organization (slices). Bounded context boundaries — which may differ — are defined in `arch.yaml`.

### Model This Operation or Skip?

1. Does the concern have its own business rules? → YES → **Model it**
2. Is it independently meaningful to stakeholders? → YES → **Model it**
3. Would it be a separate command in well-factored CQRS? → YES → **Model it**
4. Is it just setting a single field? → **Skip** (don't create virtual operations)

### Model This Data Shape or Skip?

1. Does it cross a service boundary (API payload, message)? → YES → **Model it**
2. Is it a query response users will see? → YES → **Model it** (read-model)
3. Is it purely internal to an aggregate? → **Skip** unless it appears in an API
4. Is it an infrastructure/utility response? → **Skip**

## Self-Description and Examples

A blueprint that validates can still be worthless downstream. Model properties become fields in generated OpenAPI contracts; an undescribed property is a bare field in every viewer and every generated client. The schema validator will never tell you this — it answers *"is this legal?"*. The [quality gate](schema-reference.md#quality-gate--does-it-say-anything) answers *"does this say anything?"*.

**Per entity type, what "described" means:**

| Entity | The bar |
|---|---|
| Model property | `description` + `example` |
| Model schema | `description` + `purpose` + `represents[]` |
| Event | `description` — **including the failure counterpart of a `one_of` pair** |
| Command | `description` + `produces` + `exchange` |
| Concept, actor | `description` (an actor may use `summary`) |
| Concept attribute | `description` + `example` |
| Enum value / enum property | `description` — the semantics are the whole point |
| Business rule | `statement` |
| User story | `acceptance_criteria` — without them there's nothing to derive a test from |
| Test case | `description` or `summary` |
| Decision marked confirmed/validated | **≥1 `evidence` record.** Claiming settled status while citing nothing is a defect, not a gap |
| Risk | `mitigation` or `contingency` |

None of that is advice you have to take on trust — every row is measured by a named check, so you can see where you stand before anyone reviews the model:

<!-- BEGIN CITATIONS: rules + metrics — ids verified against the rule pack and quality-spec -->

| Row | Quality-gate metric | Semantic-checker rule |
|---|---|---|
| Model property | `model.property.description`, `model.property.example` | — |
| Model schema | `model.schema.description`, `model.schema.purpose`, `model.schema.represents` | `model-without-purpose`, `model-without-represents` |
| Event | `domain.event.description` | `undescribed-event` |
| Command | `domain.command.produces`, `domain.command.exchange` | `missing-causal-links`, `missing-exchange-binding` |
| Concept, actor | `concept.description`, `concept.actor.description` | — |
| Concept attribute | `concept.attribute.description`, `concept.attribute.example` | — |
| Enum value / property | `concept.enum_value.description`, `model.enum_property.description` | — |
| Business rule | `rule.description` | `untested-rules` |
| User story | `user_story.acceptance_criteria` | `user-story-without-acceptance-criteria` |
| Test case | `test_case.description`, `test_case.provenance` | — |
| Decision evidence | `decision.evidence_when_asserted` | `decision-asserted-without-evidence` |
| Risk | `risk.mitigation` | — |

<!-- END CITATIONS -->

Run `npm run check --list` for each rule's default severity — severities are a project decision, set in `.blueprint-lint.yaml`, and are deliberately not restated here where they would drift. The quality gate reports by default and only fails under `--strict`. Both are described in [§18](schema-reference.md#18-validation-and-quality-gates).

### Presence is not coverage

The quality gate resolves every field it looks at into one of three states — **covered**, **filler**, or **missing** — and `filler` counts against you exactly like `missing`:

```yaml
# ✗ Passes a presence check and says nothing. Reported as FILLER.
discountCodes:
  type: array
  description: "The discount codes field."

# ✓ Says what it is AND why it exists.
discountCodes:
  type: array
  description: >
    Promotion codes applied to this cart, in the order the shopper entered them.
    Order matters — when two codes are mutually exclusive, the first qualifying one wins.
  example: ["SPRING10", "FREESHIP"]
```

The test for a description: **could a reader who has never seen this model tell what the field is for, and what would go wrong if it were absent?** If it only restates the field name, it is filler — the gate will say so, and it is right.

In context, that property lives in a model schema that describes *itself* as well as its fields, and points at the concept it carries:

```yaml
# file: .blueprint/v2.8/checkout/concepts.yaml
version: "1.0.0"
scope: checkout
tags: [checkout]

concepts:
  - id: checkout.CN001
    name: "Cart"
    stereotype: aggregate-root
    description: "A shopper's in-progress selection, from first item added until it becomes an order or expires."
    attributes:
      cartId:
        id: CAT001
        description: "Identifies the cart across the shopper's session and any later recovery e-mail."
        example: "8f14e45f-ea8f-4b7c-9b1a-2c3d4e5f6071"
```

```yaml
# file: .blueprint/v2.8/checkout/cart.models.yaml
version: "1.0.0"
scope: checkout
tags: [cart, models]

components:
  schemas:
    CartSummary:
      x-model-id: MDL001
      purpose: read-model
      description: "Cart state returned to the storefront after every cart mutation."
      represents:
        - concept: checkout.CN001
          kind: api
      type: object
      required: [cartId]
      properties:
        cartId:
          type: string
          format: uuid
          description: "Identifies the cart across the shopper's session and any later recovery e-mail."
          example: "8f14e45f-ea8f-4b7c-9b1a-2c3d4e5f6071"
        discountCodes:
          type: array
          items:
            type: string
          description: >
            Promotion codes applied to this cart, in the order the shopper entered them.
            Order matters — when two codes are mutually exclusive, the first qualifying one wins.
          example: ["SPRING10", "FREESHIP"]
```

`purpose` says what role the shape plays in CQRS (`command-payload` | `event-payload` | `read-model` | `shared` | `dto`); `represents[]` links it to the domain concept it carries. Together they are what lets a generator decide *where* a schema belongs — a request body, an event envelope, or a query response — instead of emitting an untyped bag. A model with neither is a shape with no home.

### The failure half of an event pair

The most commonly missed item on the list above is the **failure counterpart**. When you author `OrderPlaced` / `OrderRejected`, the happy path tends to get the prose and the failure event gets a bare id — and the failure path is the one a reader most needs explained. This is precisely what `undescribed-event` looks for.

```yaml
# file: .blueprint/v2.8/checkout/domain.yaml
version: "1.0.0"
name: Checkout
scope: checkout
tags: [checkout]

operations:
  orderPlaced:
    id: EVT001
    kind: event
    description: "The order passed validation and payment authorization; fulfillment may begin."
  orderRejected:
    id: EVT002
    kind: event
    description: >
      The order failed validation or authorization. Carries the reason so the storefront can tell
      the shopper what to fix — never silently dropped.
```

## Provenance — Say How Sure You Are

A model built by reading code is full of judgement calls, and the reader cannot tell which entities are architectural fact and which are your inference. Say so explicitly. The schema provides two complementary mechanisms:

- **Design plane** (concepts, domain, rules, models, arch) — `code_refs` is the primary provenance: an entity earns its place by pointing at the source that implements it. A grouped `provenance: { discovery_stage, certainty, evidence[] }` grades the *modeling judgement* on top of that. Use it where the judgement is non-trivial: an inferred aggregate boundary, an event implied by a flow but never present as an explicit type, a CRUD-grouped operation.
- **Governance plane** (motivation, decisions, capability, value-stream) — the flat epistemic triple: `discovery_stage` (`hypothesis` → `exploring` → `validated` → `committed` → `obsolete`), `certainty` (`speculative` → `probable` → `confirmed`), and `evidence[]`.

The design plane groups the fields under `provenance` because it already uses `certainty` with a different meaning (`rules.certainty: definitive | heuristic`); governance keeps them flat.

**Grading rubric — calibrate, do not inflate:**

| Situation | `discovery_stage` | `certainty` | Evidence kind |
|---|---|---|---|
| Architectural fact read directly from code | `committed` | `confirmed` | `codebase-analysis` → `supports` |
| Pattern strongly evidenced, but framed and named by you | `validated` | `probable` | `codebase-analysis` → `supports` |
| Intent or strategic judgement you inferred | `validated` / `exploring` | `probable` / `speculative` | `codebase-analysis` |
| A guess or analogy not yet grounded | `hypothesis` | `speculative` | `assumption` |

If something cannot be tied to evidence at all, do not assert it — make it a question (`QN###` with `answered_by: []`), which is a first-class gap rather than a false claim.

**`code_refs` is already the codebase-analysis evidence — do not duplicate it.** Where `code_refs` is present, fill in `discovery_stage` + `certainty` and omit an evidence record that merely re-points at the same files. Reserve `evidence[]` for evidence *beyond* the entity's own code: `documentation`, an `assumption`, a `stakeholder-signoff`, or analysis of a different artifact. Entities that cannot carry `code_refs` at all (goals, risks, capabilities) use one evidence record as their grounding. Every `evidence.source` should be a real path or document, so the claim is checkable; `kind` and `summary` are required.

Marking a decision `confirmed` while citing nothing is the one case where this is not a style preference — `decision-asserted-without-evidence` reports it, because an evidentiary claim with no source is a defect rather than a gap. Speculative and probable decisions are exempt by design: saying "we are not sure" is honest, and honest is what this is for.

## Anti-Patterns

| # | Name | What goes wrong | Fix |
|---|------|----------------|-----|
| AP01 | Premature Construction | Writing YAML before confirming requirements | Ask first, model second |
| AP02 | Orphan Artifact | Entity defined but never referenced anywhere | Every entity should be referenced by at least one other |
| AP03 | Missing Causal Links | Commands without `produces` | Every command must produce at least one event |
| AP04 | Events That Produce | Using `produces` on events | Events trigger reactions via `reacts_to` on commands |
| AP06 | Hairball Blueprint | Everything modeled at once, graph unreadable | Respect phase boundaries, defer aggressively |
| AP07 | Completeness-First | Trying to model everything before validating | Produce MVB fast, iterate |
| AP08 | Missing Stereotype | Aggregate roots without `stereotype: aggregate-root` | Always declare stereotype on aggregate concepts |
| AP09 | Flat Structure | Everything in one slice, no domain decomposition | Analyze for business domain boundaries first |
| AP10 | Monolithic Files | Single 700-line domain.yaml | Split at ~15 entities or ~150 lines per file |
| AP21 | Exchange on Events | Adding protocol bindings to events | Events are domain facts, not protocol-bound |
| AP27 | 1:1 Code-to-Blueprint | One blueprint operation per code method | Group CRUD variants into semantic operations |
| AP24 | Evidence-less Governance | A decision marked `confirmed`/`validated` with no `evidence[]` | Cite a source, or lower `certainty` to `probable`/`speculative` |
| AP37 | Untested Rules | Rules without corresponding test cases | Every rule needs at least one test |
| AP40 | Merged Duplicates | Root files duplicating slice content | Root files only for shared/system-level entities |
| AP63 | Echo Description | `description` restates the field name — "The discount codes field." | Say what it means and why it exists; the quality gate scores this as filler, not coverage |
| AP64 | Half-Described Pair | Only the happy half of a `one_of` event pair carries prose | Describe the failure counterpart — it is the one a reader needs explained |

## Reference Direction

Every cross-file reference has exactly one owner:

| Owner file | Fields | Points to |
|---|---|---|
| **domain.yaml** | `produces`, `reacts_to[]` | operations |
| **domain.yaml** | `governed_by[]`, `preconditions[]`, `postconditions[]` | rules |
| **domain.yaml** | `initiated_by[]` | actors |
| **domain.yaml** | `materializes[]` | concepts |
| **domain.yaml** | `questions[].answered_by[]` | operations |
| **domain.yaml** | `questions[].concepts[]` | concepts |
| **domain.yaml** | `questions[].motivated_by[]` | goals |
| **rules.yaml** | `rule.concepts[]` | concepts |
| **concepts.yaml** | `concept.transition_rules[]` | rules (transition) |
| **models.yaml** | `model.represents[]` | concepts |
| **story.yaml** | `activity.entry_operation` | operations |
| **story.yaml** | `user_story.actor` | actors |
| **story.yaml** | `user_story.operations[]` | operations |
| **story.yaml** | `use_case.primary_actor` | actors |
| **test-cases.yaml** | `validates.{rules,operations,concepts}` | respective entities |
| **decisions.yaml** | `declared_impact.direct.*` | respective entities |
| **decisions.yaml** | `motivation_refs.{goals,risks,assumptions}[]` | motivation entities |
| **capability.yaml** | `{operations,rules,concepts}[]` | domain, rules, concepts |
| **capability.yaml** | `value_stream_refs[]` | value streams |
| **value-stream.yaml** | `stages[].capabilities[]` | capabilities |
| **motivation.yaml** | `goal.kpi` | quality (KPI) |
| **quality.yaml** | `slo.operations` | operations |
| **all schemas** | `owned_by` | org entities |
| **all schemas** | `code_refs[]` | source code files |

## File Layout

```
.blueprint/v2.8/
  blueprint.yaml              # Root: name, version, layout
  arch.yaml                   # System architecture, context map
  motivation.yaml             # System-wide goals, risks
  organization.yaml            # Organizational hierarchy

  orders/                     # Business domain (slice)
    concepts.yaml
    arch.yaml                 # Orders-specific services and contracts
    domain.yaml
    rules.yaml
    story.yaml
    test-cases.yaml

  payments/                   # Another domain
    concepts.yaml
    arch.yaml                 # Payments-specific services
    domain.yaml
    ...
```

The same schema type can appear at root AND inside slices. Root `arch.yaml` describes the system context map; `orders/arch.yaml` describes services within that domain. See [File Conventions](file-conventions.md) for the full scoping rules.

### Scope — slice-local or root?

Before placing any entity, decide its scope: **one slice, or the system?**

- **Slice-local → keep it in the slice.** A checkout-only decision goes in `checkout/*.decisions.yaml`; a slice-internal service in `{slice}/*.arch.yaml`; slice goals and risks in `{slice}/*.motivation.yaml`; slice metrics in `{slice}/*.quality.yaml`. The same holds for every layer.
- **System-wide or cross-slice → root.** The bounded-context map, org hierarchy, value streams, roadmap, the enterprise capability map, system-level goals and ADRs.
- **Rule of thumb:** referenced by exactly one slice ⇒ slice-local; by two or more slices (or by the system) ⇒ lift it to root.

Root and slice files of the same type **complement** each other — root is the forest, the slice is the trees. They are not merged across levels, and the same entity must never exist at both (that is AP40).

### Rules

- One subfolder per business domain, directly under `.blueprint/v2.8/`
- Slice names: kebab-case (e.g. `order-management`)
- Root-level files: only for shared/system-level content (arch, org, system goals)
- ID prefixing: `{slice}.{PREFIX}{NNN}` (e.g. `orders.CN001`, `payments.CMD001`)
- Split files when they exceed ~15 entities or ~150 lines: `consumer.concepts.yaml`, `fulfillment.story.yaml`

### File naming for sub-files

Pattern: `{semantic-prefix}.{schema-type}.yaml`

The loader merges all files of the same schema type within a slice. Root-level tags from each file apply to entities in that file.

## Operation Kinds

| Kind | Semantics | Typical produces | ID prefix |
|------|-----------|-----------------|-----------|
| `command` | Intent to change state (imperative) | events, documents | CMD |
| `event` | Fact that happened (past tense, broadcast) | nothing | EVT |
| `query` | Read-only data request | nothing | QRY |
| `document` | Full state transfer | nothing | DOC |

### Causal chain pattern

```yaml
operations:
  submitOrder:
    id: CMD001
    kind: command
    produces:
      operations: [EVT001]
      mode: all               # all | one_of | any

  orderSubmitted:
    id: EVT001
    kind: event               # no produces, no exchange

  validatePayment:
    id: CMD002
    kind: command
    reacts_to:
      - operation: EVT001
        policy: "Always validate payment for new orders"
```

**Key rule:** Always model event→command as `reacts_to` on the command, not `produces` on the event. Events are domain facts — they don't "do" anything. Commands react to them.

## SBVR Modality for Rules

| Modality | Meaning | Use for |
|----------|---------|---------|
| `necessary` | Invariant that must hold | Data integrity |
| `obligatory` | System must enforce | Validation |
| `prohibited` | Must never happen | Security constraints |
| `permitted` | Explicitly allowed | Optional behavior |

## Questions as Domain Gaps

Questions (QN###) model what knowledge a domain slice should provide. They are first-class entities, not properties on operations, because:

- Questions exist before operations (requirements precede implementation)
- Questions span all operation kinds (queries, commands, events, documents)
- Questions have N:M relationships with operations
- Unanswered questions (`answered_by: []`) are the most valuable artifact for gap analysis

```yaml
questions:
  - id: QN001
    statement: "What is the customer's lifetime value?"
    category: measurement
    priority: high
    answered_by: []           # DOMAIN GAP — no operation answers this yet
```

Seven category values: `existence`, `enumeration`, `relationship`, `measurement`, `temporal`, `behavioral`, `compliance`.
