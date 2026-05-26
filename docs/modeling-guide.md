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
| AP37 | Untested Rules | Rules without corresponding test cases | Every rule needs at least one test |
| AP40 | Merged Duplicates | Root files duplicating slice content | Root files only for shared/system-level entities |

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
.blueprint/v2.7/
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

### Rules

- One subfolder per business domain, directly under `.blueprint/v2.7/`
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
