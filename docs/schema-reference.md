# Blueprint Schema Reference

Complete reference for Archally Blueprint Schema definitions. Covers entity types, ID patterns, versioning, traceability, and modeling conventions.

> **Priority order:** Domain-first (B) > Ops-first (C) > Contract-first (A). Blueprint is Project Memory.

---

## 1. What is a Blueprint?

A blueprint is a multi-layer machine-readable specification of a software system. It captures domain vocabulary (concepts), invariants (rules), interactions (operations), design decisions, business intent (motivation), and runtime behavior — all in one coherent model.

Blueprints are consumed by AI agents and humans alike. Every schema field is described. Every ID is typed and traceable across layers.

---

## 2. Architecture

Two planes + one cross-cutting metamodel:

```
┌──────────────────────────────────────────────────────────┐
│                       METAMODEL                          │
│           ID patterns · versioning · shared vocab        │
└────────────────────┬─────────────────────────────────────┘
                     │ consumed by both planes
          ┌──────────┴──────────┐
          │                     │
┌─────────┴────────┐ ┌──────────┴──────────────┐
│   DESIGN PLANE   │ │   GOVERNANCE PLANE       │
│   What & How     │ │   Why & Proof            │
│                  │ │                          │
│ arch             │ │ motivation               │
│ concepts         │ │ capability               │
│ rules            │ │ decisions                │
│ domain           │ │ test-cases               │
│ models           │ │ organization   (v2.2)    │
│ infrastructure   │ │ roadmap        (v2.5)    │
│ story            │ │                          │
│ dynamics         │ │                          │
│ quality          │ │                          │
│ interactions     │ │                          │
└──────────────────┘ └──────────────────────────┘
```

---

## 3. Schema Inventory

| Schema | Plane | Purpose |
|--------|-------|---------|
| `metamodel.schema.yaml` | Cross-cutting | Typed ID refs, versioning, shared vocabulary |
| `migration.schema.yaml` | Cross-cutting | Model migrations: entities, properties, relationships, meta changes |
| `arch.schema.yaml` | Design | Bounded contexts, services, contracts, dependencies |
| `concepts.schema.yaml` | Design | Domain vocabulary, actors, enumerations, state/lifecycle |
| `rules.schema.yaml` | Design | Business rules, invariants, transitions |
| `domain.schema.yaml` | Design | Operations with protocols, payloads, responses |
| `models.schema.yaml` | Design | Data shapes (OpenAPI/AsyncAPI compatible) |
| `infrastructure.schema.yaml` | Design | Infrastructure resources, deployment topology |
| `story.schema.yaml` | Design | Domain stories as operation sequences |
| `dynamics.schema.yaml` | Design | Concurrency, parallelism, ordering, race conditions |
| `quality.schema.yaml` | Design | Metrics, KPIs, SLOs, SLAs, security, compliance, observability |
| `motivation.schema.yaml` | Governance | Vision (identity/north-star), goals, non-goals, risks, assumptions, trade-offs |
| `capability.schema.yaml` | Governance | Business capability map (hierarchical) |
| `decisions.schema.yaml` | Governance | Architecture Decision Log (ADR) |
| `test-cases.schema.yaml` | Governance | Test cases validating rules, operations, concepts |
| `organization.schema.yaml` | Governance | Organizational hierarchy: parties, departments, teams (v2.2) |
| `interactions.schema.yaml` | Design | UI screens, actions, and navigation with cross-links (v2.2) |
| `roadmap.schema.yaml` | Governance | Product milestones with deliverables and success criteria (v2.5); execution-tier work items / WBS with sprint cadence and typed relations (v2.7.2) |

> **Note:** In v2.6 and earlier, `infrastructure.schema.yaml` was named `rg.schema.yaml`, `interactions.schema.yaml` was `ui.schema.yaml`, and `organization.schema.yaml` was `org.schema.yaml`. The v2.7 names are used throughout this document.

### Slice Layout (Recommended for Large Blueprints)

When `layout.mode: slices` is set in `blueprint.yaml`, domain slices are **business domain directories** directly under `.blueprint/` (not nested under `domains/`). A slice groups artifacts by business domain; bounded contexts are architectural boundaries defined in `arch.yaml` and may map 1:1 to slices or subdivide them:

```
.blueprint/
  blueprint.yaml
  # Root-level (optional — only when shared/system content exists)
  arch.yaml                 # System architecture, bounded context map
  motivation.yaml           # System goals
  quality.yaml, capability.yaml, decisions.yaml, dynamics.yaml, infrastructure.yaml

  identity/                 # Domain slice (kebab-case)
    capability.yaml
    concepts.yaml
    decisions.yaml
    domain.yaml
    dynamics.yaml
    models.yaml
    motivation.yaml
    quality.yaml
    infrastructure.yaml
    rules.yaml
    story.yaml
    test-cases.yaml
    README.md               # Slice-specific explanation
  adventure/
    ...
```

A context declares which slice owns it with `domain_ref` on the context, naming a slice from
`layout.slices`. It is optional: a context whose `arch.yaml` sits in a slice directory belongs to
that slice already. Declare it when a context belongs to a slice other than the one its location
implies, or when the file sits at the model root and so implies none.

- **Slices:** Each subfolder is a full artifact set. Use `{slice}.{PREFIX}{NNN}` IDs (e.g. `adventure.CN001`, `identity.CMD001`).
- **Root files:** Only add root-level design/governance files for **shared entities** (used by multiple slices) or **system-level content** (arch, goals, quality). Do not create root `concepts.yaml`, `rules.yaml`, etc. if they would only duplicate slice content.
- **Note:** A "domain slice" is a business domain directory (subfolder); the file `domain.yaml` is a blueprint artifact — the two are unrelated. Bounded contexts are defined in `arch.yaml`.

---

## 4. Versioning

| Level | Field | Required | Example |
|-------|-------|----------|---------|
| Schema definition | `$id` (URN) | Yes | `urn:archally:blueprint:concepts:2.0.0` |
| Document | `version` | Yes | `"1.3.0"` |
| Document | `schemaVersion` | No | `"2.0.0"` |
| Entity | `version` | No | `"1.0.0"` |

SemVer rules: **major** = breaking change, **minor** = new optional capability, **patch** = docs/clarification.

---

## 5. ID Patterns

All IDs support optional context prefix using dot notation (e.g. `billing.CN001`):

| Entity | Pattern | Example |
|--------|---------|---------|
| Concept | `CN\d{3}` | `CN001`, `billing.CN001` |
| Actor | `ACT\d{3}` | `ACT001` |
| Enumeration | `EN\d{3}` | `EN001` |
| Association | `AS\d{3}` | `AS001` |
| Rule | `(SR\|CR\|DR\|EQ\|VR)\d{3}` | `SR001`, `billing.SR001` |
| Transition | `TR\d{3}` | `TR001` |
| Command | `CMD\d{3}` | CMD001 |
| Event | `EVT\d{3}` | EVT001 |
| Query | `QRY\d{3}` | QRY001 |
| Document | `DOC\d{3}` | DOC001 |
| Decision | `D\d{3}` | `D001`, `billing.D001` |
| Goal | `G\d{3}` | `G001` |
| Non-goal | `NG\d{3}` | `NG001` |
| Risk | `R\d{3}` | `R001` |
| Assumption | `A\d{3}` | `A001` |
| Trade-off | `T\d{3}` | `T001` |
| Capability | `CAP\d{3}` | `CAP001` |
| Test (happy) | `TC\d{3}` | `TC001` |
| Test (edge) | `EC\d{3}` | `EC001` |
| Test (error) | `ER\d{3}` | `ER001` |
| Metric | `MT\d{3}` | `MT001` |
| KPI | `KPI\d{3}` | `KPI001` |
| SLO | `SLO\d{3}` | `SLO001` |
| SLA | `SLA\d{3}` | `SLA001` |
| Security | `SEC\d{3}` | `SEC001` |
| Compliance | `CMP\d{3}` | `CMP001` |
| Resilience | `RES\d{3}` | `RES001` |
| Parallelism | `PAR\d{3}` | `PAR001` |
| Ordering | `ORD\d{3}` | `ORD001` |
| Race condition | `RC\d{3}` | `RC001` |
| Story activity | `SA\d{3}` | `SA001` |
| Story process | `SP\d{3}` | `SP001` |
| Error | `ERR\d{3}` | `ERR001` |
| Fitness function | `FF\d{3}` | `FF001` |
| Migration | `MIG\d{3}` | `MIG001` |
| Concept attribute | `CAT\d{3}` | `CAT001` |
| Story | `STR\d{3}` | `STR001` |
| Screen | `SCR\d{3}` | `SCR001` |
| UI Action | `UAC\d{3}` | `UAC001` |
| UI Navigation | `UNV\d{3}` | `UNV001` |
| Party | `PRT\d{3}` | `PRT001` |
| Department | `DPT\d{3}` | `DPT001` |
| Team | `TM\d{3}` | `TM001` |
| Model (x-extension) | `MDL\d{3}` | `MDL001` |
| Question | `QN\d{3}` | `QN001`, `billing.QN001` |
| User Story | `US\d{3,}` | `US001`, `orders.US001` |
| Use Case | `UC\d{3,}` | `UC001`, `orders.UC001` |
| Milestone | `MS\d{3,}` | `MS001`, `roadmap.MS001` |
| Work Item | `WI\d{3,}` | `WI001`, `roadmap.WI001` |

Rule prefixes: `SR`=structural, `CR`=classification, `DR`=derivation, `EQ`=equivalence, `VR`=validation.

**Operation ID numbering:** Use a single counter across all operation kinds within a slice. IDs reflect creation order, not kind-specific sequences. Gaps within a prefix are expected (e.g., CMD001, EVT002, CMD003 — there is no CMD002).

**ID-kind consistency:** The operation ID prefix must match the `kind` field. Validator warns on mismatch.

---

## 6. Naming Conventions

- **File names**: kebab-case (`test-cases.schema.yaml`)
- **SpecPath segments**: kebab-case (`test-cases.happy-path.TC001`)
- **Property names**: snake_case (`logic_tuple`, `change_kind`)
- **Context prefixes**: kebab-case (`order-mgmt`)
- **Enum values**: kebab-case (`event-driven`, `very-low`)

---

## 7. Profiles (Extensibility)

Profiles allow domains to extend the blueprint without forking core schemas.

**How profiles work:**
1. Define a profile in `blueprint.yaml` -> `profiles[]`
2. Add schema files that extend or complement core schemas
3. Document constraints the profile enforces
4. Tooling loads core + profile schemas for validation

**Example — Healthcare profile:**
```yaml
profiles:
  - name: healthcare
    description: "HIPAA compliance, patient data, clinical concepts."
    extends:
      - quality.schema.yaml
      - concepts.schema.yaml
    schemas:
      - file: "./profiles/healthcare/hipaa-compliance.schema.yaml"
        description: "HIPAA-specific compliance requirements."
    constraints:
      - "All concepts with PII must have compliance_ref to CMP entries"
      - "All operations handling patient data must have SEC entries"
```

**Profile design rules:**
1. Profiles MUST NOT remove or weaken core schema constraints
2. Profiles MAY add required fields to specific entity types
3. Profiles MAY introduce new schemas alongside core ones
4. Core schemas remain valid without any profile

---

## 8. Getting Started

### Minimal Blueprint (~10 lines)

The smallest valid blueprint. Two files, one concept.

```yaml
# blueprint.yaml
version: "1.0.0"
name: "Todo App"
```

```yaml
# concepts.yaml
version: "1.0.0"
concepts:
  - id: CN001
    term: "Todo Item"
    summary: "A task to be completed"
    definition: "A unit of work with a title and completion status"
```

### Medium Blueprint (~80 lines)

A small service with concepts, rules, one operation, one story, one test, and a goal. Shows cross-layer traceability.

```yaml
# concepts.yaml
version: "1.0.0"
concepts:
  - id: CN001
    term: "Order"
    summary: "A customer purchase request"
    definition: "Collection of items a customer wants to buy"
    states:
      - name: draft
      - name: submitted
      - name: confirmed
    initial_state: draft
    terminal_states: [confirmed]
    transition_rules: [TR001]
actors:
  - id: ACT001
    name: "Customer"
    type: human
    summary: "End user placing orders"
```

```yaml
# rules.yaml
version: "1.0.0"
structural:
  - id: SR001
    name: "Order must have items"
    summary: "An order requires at least one item"
    logic:
      then: "Order.items.count > 0"
    modality: necessary
    concepts: [CN001]
transition:
  - id: TR001
    name: "Submit order"
    summary: "Order transitions from draft to submitted"
    concept: CN001
    from: draft
    to: submitted
    guard:
      when: "all items validated"
```

```yaml
# domain.yaml
version: "1.0.0"
name: "Orders"
operations:
  submitOrder:
    id: CMD001
    kind: command
    name: "Submit Order"
    governed_by:
      - rule: SR001
    postconditions:
      - rule: TR001
```

```yaml
# motivation.yaml
version: "1.0.0"
goals:
  - id: G001
    statement: "Process orders within 2 seconds"
    priority: high
```

```yaml
# test-cases.yaml
version: "1.0.0"
happy_path:
  - id: TC001
    name: "Submit valid order"
    summary: "Order with items submits successfully"
    validates:
      rules: [SR001, TR001]
      operations: [CMD001]
```

### Full Blueprint

A complete e-commerce bounded context with all planes populated demonstrates all schemas in a cohesive example: architecture with contracts, concepts with actors and enumerations, rules with transitions, operations, models, a story, dynamics, quality with metrics/SLOs, motivation with goals/risks, capabilities, decisions, and tests.

---

## 9. Traceability Map

Cross-layer reference paths for tooling validation:

| From | To | Via | Strength |
|------|----|-----|----------|
| Goal | KPI | `goal.kpi` | Optional (recommended) |
| KPI | Metric | `kpi.metric` | Required if KPI exists |
| Metric | Operation/Concept | `metric.measures` | Optional |
| SLO | Metric + Operations | `slo.metric`, `slo.operations` | Required if SLO exists |
| SLA | SLOs | `sla.slos` | Required if SLA exists |
| Capability | Operations | `capability.operations` | Optional |
| Decision | Motivation | `decision.motivation_refs` | Optional (recommended) |
| Decision | Capability | `decision.capability_refs` | Optional |
| Test | Rules/Operations/Concepts | `test.validates` | Required |
| Operation | Rules | `operation.governed_by` | Required (typed ref) |
| Rule | Concepts | `rule.concepts` | Optional (recommended) |
| Concept | Transition rules | `concept.transition_rules` | Optional |
| Concept attribute | Model property | `represents[].property_map` | Optional (v2.2) |
| Model | Concept | `represents[].concept` | Optional (v2.2) |
| Decision | Models/Stories/UI | `declared_impact.direct` | Optional (v2.2) |
| Test | Models/Stories/UI/Ownership | `test.validates` | Optional (v2.2) |
| Screen | Models | `screen.uses_models` | Optional (v2.2) |
| Screen | Stories | `screen.stories` | Optional (v2.2) |
| Action | Operations | `action.triggers_operations` | Optional (v2.2) |
| Navigation | Screens | `navigation.from/to` | Required (v2.2) |
| Entity | Team/Dept/Party | `owned_by` | Optional (v2.2) |
| Entity | Source code | `code_refs` | Optional (v2.4) |
| Concept | DDD classification | `stereotype` | Optional (v2.4) |
| Question | Operations | `answered_by` | Optional (v2.4) |
| Question | Concepts | `concepts` | Optional (v2.4) |
| Question | Goals | `motivated_by` | Optional (v2.4) |
| Service | API URLs | `servers` | Optional (v2.4) |
| Operation | Test examples | `examples` | Optional (v2.4) |
| User Story | Actor | `user_story.actor` | Required (v2.5) |
| User Story | Operations | `user_story.operations` | Optional (v2.5) |
| User Story | Tests | `user_story.test_cases` | Optional (v2.5) |
| User Story | Use Case | `user_story.use_case` | Optional (v2.5) |
| Use Case | Actor | `use_case.primary_actor` | Required (v2.5) |
| Use Case | User Stories | `use_case.user_stories` | Optional (v2.5) |
| Use Case | Stories | `use_case.stories` | Optional (v2.5) |
| Use Case | Operations | `use_case.main_scenario[].operation` | Optional (v2.5) |
| Use Case | Screens | `use_case.main_scenario[].screen` | Optional (v2.5) |
| Milestone | Milestones | `milestone.dependencies` | Optional (v2.5) |
| Milestone | Deliverables | `milestone.deliverables[].ref` | Optional (v2.5) |
| Question | Owner | `question.owner` | Optional (v2.5) |
| Risk | Owner | `risk.owner` | Optional (v2.5) |

Enforcement levels:
- **Required:** Schema validation rejects if missing
- **Recommended:** Tooling warns if missing; not schema-enforced
- **Optional:** Available for depth; no validation

---

## 10. v2.1 New Fields

### Domain (domain.schema.yaml)
- **operations**: Dictionary keyed by camelCase name (e.g. `submitOrder`). Each operation has required `id` (CMD/EVT/QRY/DOC + number). Keys provide human-readable references in arch.yaml expose lists (e.g. `orders:submitOrder`).
- **produces**: Optional object with `operations[]` (operation_ref) and `mode` (any|one_of|all). Commands typically produce events/documents.
- **reacts_to**: Optional array of `{ operation, policy?, condition?, rule? }` — events this operation reacts to.
- **task_type**: Optional enum (automated|manual|user-decision|external).
- **errors[]**: Optional top-level catalog of domain errors (ERR001, etc.) with category, severity, http_status.
- **response.error**: Optional error_ref linking to errors catalog.
- **tags**: Root and entity level.

### Story (story.schema.yaml)
- **activities[]**: Replaces operations[]. Each activity has required `id` (SA001), `name`, `entry_operation`.
- **entry_operation**: Domain operation where activity begins; generator follows causal chain from here.
- **steps[]**: Optional convenience view of operations in activity. Domain causal links are authoritative; validator WARNS if steps contradict.
- **next_activities**, **path_type** (happy|error|compensation): Optional flow metadata.
- **process**: Optional object with trigger, end_states, lanes — enables BPMN generation.
- **tags**: Root, story, and activity level.

### Models (models.schema.yaml)
- **purpose**: Optional enum (command-payload|event-payload|read-model|shared|dto).
- **concept**: Optional back-reference to domain concept.
- **tags**: Root and model level.

### Test-cases (test-cases.schema.yaml)
- **fitness_functions[]**: Optional array of architectural fitness functions (FF001) with assertion, scope, severity.
- **tags**: Root and entity level.

### Blueprint (blueprint.schema.yaml)
- **constitution**: Optional principles, naming_conventions, conventions. Produces convention documented. Operation ID-Kind Consistency: prefix must match kind (CMD/EVT/QRY/DOC); validator warns on mismatch.

---

## 11. v2.2 New Fields

### Concept Attributes (concepts.schema.yaml)

Concepts gain structured `attributes` — keyed by business name, each with a typed ID (CAT###):

```yaml
concepts:
  - id: CN001
    term: "Order"
    attributes:
      orderId:
        id: CAT001
        description: "Unique order identifier"
        example: "ORD-2026-0042"
      status:
        id: CAT002
        description: "Current lifecycle state"
        example: "submitted"
```

Attributes enable **concept-to-model traceability** — each model property can map to a specific concept attribute via `property_map`.

### Model Represents & x-model-id (models.schema.yaml)

`concept` back-ref replaced with `represents[]` array supporting multiple concept mappings with strategy:

```yaml
components:
  schemas:
    Order:
      x-model-id: MDL002
      represents:
        - concept: CN001
          kind: persistence          # api | event | persistence | ui | report | other
          mapping:
            strategy: property-map   # property-map | same-names
            property_map:
              orderId: CAT001
              status: CAT002
```

- **x-model-id** (MDL###): Optional typed ID for viewer graph identity (JSON Schema x-extension — doesn't pollute OpenAPI schemas)
- **kind**: How the model represents the concept (API payload, persistence, event, UI, report)
- **strategy**: `property-map` for explicit mapping, `same-names` when properties match attributes

### Story IDs (story.schema.yaml)

Stories get typed IDs via `story_ref` (STR###), replacing the informal `storyId`:

```yaml
stories:
  - id: STR001
    title: "Customer submits order"
    activities:
      - id: SA001
        name: "Submit Order"
        entry_operation: "orders.CMD001"
```

### Organization Schema (organization.schema.yaml) — NEW

Party > Department > Team hierarchy for organizational ownership:

```yaml
parties:
  - id: PRT001
    name: "E-Shop"
    departments:
      - id: DPT001
        name: "Engineering"
        teams: [TM001, TM002]
    teams:
      - id: TM001
        name: "Order Platform Team"
        contact:
          email: orders@eshop.example
          slack: "#team-orders"
```

### Ownership (owned_by)

File-level default + entity-level override. Exactly one owner (team, department, or party):

```yaml
# File-level (applies to all entities in file)
owned_by:
  team: TM001

# Entity-level override
concepts:
  - id: CN002
    term: "Order Line"
    owned_by:
      department: DPT002    # overrides file-level TM001
```

### Interactions Schema (interactions.schema.yaml) — NEW

Screens, actions, and navigation with cross-links to models, stories, tests, and operations:

```yaml
screens:
  - id: SCR001
    name: "Order List"
    uses_models: [OrderList]
    stories: [STR001]
actions:
  - id: UAC001
    name: "Submit Order"
    screen: SCR002
    triggers_operations: [orders.CMD001]
navigation:
  - id: UNV001
    from: SCR001
    to: SCR002
    condition: "Order selected from list"
```

### Expanded Decision Impact (decisions.schema.yaml)

`declared_impact.direct` gains models, stories, and UI arrays:

```yaml
declared_impact:
  direct:
    concepts: [CN001]
    operations: [QRY001]
    models: [OrderList, Order]
    stories: [STR001]
    ui:
      screens: [SCR001, SCR002]
      actions: [UAC001]
      navigation: [UNV001]
  transitive_hints:
    - "Pagination logic may need backend query support"
```

### Expanded Test Validates (test-cases.schema.yaml)

`validates` gains models, stories, UI, and ownership:

```yaml
validates:
  operations: [CMD001]
  concepts: [CN001]
  models: [SubmitOrderRequest, Order]
  stories: [STR001]
  ui:
    screens: [SCR002]
    actions: [UAC001]
  ownership: [TM001]
```

### Multi-Protocol Exchange (domain.schema.yaml)

Operations support additional protocols beyond HTTP:

```yaml
exchange:
  protocol: kafka           # http | grpc | amqp | amqp091 | amqp1 | mqtt | kafka | x-custom
  topic:
    name: "orders.submitted"
    description: "Kafka topic for order events"
```

Supported: `http`, `http-sse`, `tcp`, `tds/tcp`, `grpc`, `trpc`, `orpc`, `json-rpc`, `x-ws`, `amqp`, `amqp091`, `amqp1`, `mqtt`, `kafka`, `graphql`, `stdio`, and `x-*` custom protocols. RPC protocols (`tcp`/`grpc`/`trpc`/`orpc`/`json-rpc`/`x-ws`) require the `method` binding.

### Typed Contracts (arch.schema.yaml)

Service contracts use typed protocol sections with `operation_ref[]`:

```yaml
services:
  - name: order-api
    kind: api              # service | worker | api | webapp | cli | library | function
    handles: [pricing:recalculateTotals]   # in-process; no transport asserted
    contracts:
      openapi:
        expose: [orders:submitOrder, orders:getOrder]
      asyncapi:
        send: [orders:orderSubmitted]
        receive: [orders:sendConfirmation]
```

An operation belongs to the bounded context(s) whose services provide it, and there are three ways
to say so. `expose:` and `send:` sit inside a contract, so declaring either asserts a channel.
`handles:` sits on the service and asserts none: it is for an operation called in-process, which has
no protocol and therefore no contract to put it in.

| Key | Where | Direction | Asserts a transport |
|---|---|---|---|
| `expose:` | inside a contract | provider | yes, the contract's protocol |
| `send:` | inside a contract | provider | yes, the contract's protocol |
| `handles:` | on the service | provider | no |
| `call:` | inside a contract | **consumer** | yes |

`call:` is the one to be careful with. It reads like a sibling of the other three and is the
opposite direction: it names operations this service DEPENDS ON, not ones it owns. Binding a
service to an operation it merely calls would record the caller as the handler.

All three provider keys are m:n. Two services in different bounded contexts may each declare the
same operation, and each declaration produces its own binding, because an operation the domain
shares really is handled in more than one place.

Never add a channel an operation does not have in order to silence the `unbound-operation` rule: the
model then states a transport that does not exist, and every diagram generated from it draws that
transport as fact. `handles:` exists so the honest answer is expressible.

---

## 12. v2.3 New Fields

### Properties Extension Bag (all schemas)
Every entity type gains an optional `properties` object for custom metadata. Core schema keeps `additionalProperties: false` for typo protection; the `properties` bag is the escape hatch:

```yaml
concepts:
  - id: CN001
    name: "Order"
    properties:
      term: "Purchase Order"
      definition: "Collection of items a customer intends to purchase."
      domain_expert: "Jane Doe"
```

### Name/Description Primacy (concepts, rules)
- `name` replaces `term` as primary field (both accepted for backward compatibility)
- `description` replaces `definition` as primary field
- DDD-specific terms (`term`, `definition`) move to `properties` as recommended location

### Progressive Enrichment (domain, rules)
- `exchange` made optional on operations (events are domain facts, not API endpoints)
- `logic` made optional on rules (enables Phase 1 sketching with just name + description)
- `summary` made optional where previously required <!-- public-docs-scan:allow version-history is user-facing migration guidance -->
- `operation.properties` renamed to `operation.traits` (frees `properties` for extension bag)

---

## 13. v2.4 New Fields

### Concept Stereotype (concepts.schema.yaml)

Concepts gain an explicit DDD stereotype for deterministic classification:

```yaml
concepts:
  - id: CN001
    name: "Order"
    stereotype: aggregate-root    # entity | value-object | aggregate-root | domain-service | specification
    description: "Customer purchase request with line items and payment intent"
```

Stereotypes are author-declared, not inferred. The Event Storming view derives aggregate stickies directly from `stereotype: aggregate-root`. Semantic validators warn if an aggregate-root lacks signals (states, contains relationships, governed-by rules).

### Code References (`code_refs`)

28 entity types across blueprint layers support an optional `code_refs` array linking the domain model entity to its implementation in source code. (Excluded: motivation, capability, and organization entities — strategic-level constructs without direct code counterparts.)

#### What to reference (guidance for authors and AI agents)

| Entity Type | Worth Referencing | Examples |
|-------------|------------------|----------|
| **Concept** | Class/interface defining the domain type | `src/models/Order.ts`, `src/interfaces/IOrder.ts` |
| **Operation** | Handler/controller implementing the operation | `src/handlers/CreateOrderHandler.ts` |
| **Rule** | Validation logic enforcing the rule | `src/rules/validateOrderTotal.ts` |
| **Service** | Main entry point or service root | `src/services/order-service/index.ts` |
| **Decision** | ADR document or config reflecting the decision | `docs/adrs/003-use-event-sourcing.md` |
| **Test Case** | Test file exercising the scenario | `tests/integration/createOrder.test.ts` |
| **Model** | Schema definition file | `src/schemas/OrderSchema.json` |
| **Story** | Acceptance test or E2E test for the flow | `tests/e2e/orderFlow.spec.ts` |

#### When NOT to reference

- Generated files (they change on rebuild)
- Node_modules or vendor dependencies
- Large files where the entity is a small part (reference the specific module instead)
- Files that change frequently for unrelated reasons

#### Cross-repository references

For files in a different repository, use URI-style prefix:

```yaml
code_refs:
  - path: src/models/Order.ts          # same repo
    role: model
  - path: acme/shared-types#src/Order.ts  # different repo
    role: interface
    description: "Shared TypeScript interface"
```

The viewer constructs clickable links using the blueprint's `repository` config (single repo) — or the `repositories` map for cross-repo prefixes (see below) — plus the hosting provider's URL pattern.

### Repository Configuration (blueprint.schema.yaml)

Enable clickable code references in the viewer by configuring the repository:

```yaml
repository:
  url: "https://github.com/acme/order-service"
  branch: "main"
  provider: "github"     # github | gitlab | bitbucket
```

For blueprints whose `code_refs` span **multiple repositories** (the `org/repo#path` form above), use the
`repositories` map (added v2.7.1). The map **key** is the code_ref prefix (the `org/repo` segment before `#`);
unprefixed (same-repo) refs fall back to the single `repository`:

```yaml
repositories:
  "acme/order-service":      # resolves code_refs "acme/order-service#..."
    url: "https://github.com/acme/order-service"
    provider: "github"
  "acme/shared-types":       # a different repo, different provider
    url: "https://gitlab.com/acme/shared-types"
    branch: "main"
    provider: "gitlab"
```

### Domain Questions (`questions[]`)

Questions model **what knowledge this domain slice was created to provide**. They are first-class entities in `domain.schema.yaml` with typed IDs (`QN001`, `billing.QN001`).

#### Why questions are separate entities

Questions are modeled as independent entities — not embedded properties on operations — for five fundamental reasons grounded in knowledge modeling and ontology engineering:

1. **Questions exist before operations.** Requirements precede implementation. A question like "What is the customer's lifetime value?" may exist as a domain requirement long before any operation implements it. Unanswered questions (empty `answered_by`) are the most valuable artifact for **gap analysis** — they reveal what the domain *should* be able to answer but can't yet.

2. **Questions span all operation kinds.** Not just queries:
   - "What is the order status?" -> answered by a **query** (QRY)
   - "Can a customer cancel after shipping?" -> answered by a **command** (CMD)
   - "What happens when inventory hits zero?" -> answered by an **event** chain (EVT)
   - "What data does the invoice contain?" -> answered by a **document** (DOC)

3. **Questions have N:M relationships with operations.** One question ("What is the financial health of this customer?") may require multiple operations to answer. One operation (GetOrderDetails) may answer multiple questions.

4. **Questions are referenceable from the strategic layer.** Goals reference them (why does this question matter?). Decisions reference them (this decision was driven by the need to answer question X). Test cases validate them (does the system correctly answer this?). Embedded properties can't be referenced by ID from other schemas.

5. **Unanswered questions drive backlog prioritization.** A question with empty `answered_by` is a domain gap — a knowledge requirement with no implementation. This is the killer feature for domain completeness analysis.

**Pattern origin:** Competency Questions (Gruninger & Fox 1995, ontology engineering), Goal-Question-Metric (Basili 1984, measurement theory).

#### Relations

| Direction | Relation | Target | Description |
|-----------|----------|--------|-------------|
| **Outbound** | `answered_by` | operation (any kind) | Operations that answer this question |
| **Outbound** | `concepts` | concept | Domain terms the question is about |
| **Outbound** | `motivated_by` | goal | Strategic goals driving this question |
| **Outbound** | `stakeholders` | actor | People who need the answer |
| **Inbound** | `validates.questions` | test_case | Tests validating answer quality |
| **Inbound** | `motivation_refs.questions` | decision | Decisions driven by this question |

#### Traceability chain

```
Goal -> Question -> Operation -> Read Model -> UI Screen
       ^                                    ^
    Decision                            Test Case
```

#### Example

```yaml
questions:
  - id: QN001
    statement: "What is the current status of a customer's order?"
    name: Order Status
    category: measurement
    priority: critical
    answered_by: [QRY003]
    concepts: [CN001, CN002]
    motivated_by: [G001]
    stakeholders: [ACT001]

  - id: QN002
    statement: "Can a customer cancel an order after it has shipped?"
    name: Post-Ship Cancellation
    category: behavioral
    priority: high
    answered_by: [CMD005]

  - id: QN003
    statement: "What is the customer's lifetime value?"
    name: Customer LTV
    category: measurement
    priority: medium
    answered_by: []             # DOMAIN GAP — no operation answers this yet
```

#### Question categories (Competency Question taxonomy)

| Category | Pattern | Example |
|----------|---------|---------|
| `existence` | Does X exist? | "Is there an active subscription for this customer?" |
| `enumeration` | What are all X? | "What products are in the catalog?" |
| `relationship` | How does X relate to Y? | "Which orders belong to this customer?" |
| `measurement` | What is the value of X? | "What is the current order total?" |
| `temporal` | When did X happen? | "When was the last payment received?" |
| `behavioral` | What happens when X? | "What happens when inventory reaches zero?" |
| `compliance` | Does X satisfy Y? | "Does this order meet the minimum amount rule?" |

### Server Definitions (arch.schema.yaml)

Services gain an optional `servers[]` array for API endpoint URLs, distinct from `infrastructure.yaml` infrastructure resources:

```yaml
services:
  - name: order-api
    kind: api
    servers:
      - url: "https://api.example.com/v1"
        description: "Production API"
        environment: production        # production | staging | development | test | x-custom
      - url: "http://localhost:3000/v1"
        description: "Local development"
        environment: development
```

**servers[] vs infrastructure.yaml:** `servers[]` describes the *external contract surface* — URLs that API consumers use. `infrastructure.yaml` describes *internal infrastructure topology* — databases, message brokers, caches, deployment tiers. A service has servers (how clients reach it) and resources (what it runs on).

### Operation Examples (domain.schema.yaml)

Operations gain optional `examples[]` for contract testing scenarios:

```yaml
operations:
  submitOrder:
    id: CMD001
    kind: command
    name: "Submit Order"
    examples:
      - name: "Standard order submission"
        scenario: happy-path
        provider_state: "Customer has items in cart"
        request: { orderId: "ORD-001", items: [{sku: "WIDGET-001", qty: 2}] }
        response: { status: "submitted" }
        response_code: "200"
      - name: "Empty cart rejection"
        scenario: error
        provider_state: "Customer has empty cart"
        request: { orderId: "ORD-002", items: [] }
        response: { error: "ERR001" }
        response_code: "400"
```

Examples support Pact-style `provider_state` for consumer-driven contract tests.

### GraphQL Protocol (domain.schema.yaml)

Operations support GraphQL as a first-class protocol:

```yaml
operations:
  getOrder:
    id: QRY001
    kind: query
    name: "Get Order"
    exchange:
      protocol: graphql
      graphql:
        field: "order"
        type: query              # query | mutation | subscription
```

### Idempotency and Correlation (domain.schema.yaml)

Commands gain optional `idempotency_key` for safe retries. Operations gain optional `correlation_id` for distributed tracing:

```yaml
operations:
  submitOrder:
    id: CMD001
    kind: command
    idempotency_key: "X-Idempotency-Key"
  sendConfirmation:
    id: CMD002
    kind: command
    correlation_id:
      location: "$.headers.X-Correlation-ID"
      description: "Distributed tracing correlation identifier"
```

### GraphQL Contracts (arch.schema.yaml)

Service contracts support GraphQL alongside OpenAPI and AsyncAPI:

```yaml
contracts:
  openapi:
    expose: [orders:submitOrder, orders:getOrder]
  asyncapi:
    send: [orders:orderSubmitted]
  graphql:
    expose: [orders:getOrder]
```

---

## 14. Tags System (from v2.1)

Tags are free-form string arrays for flexible multi-dimensional categorization.

**Root-level tags** apply to all entities in the file. **Entity-level tags** are merged with root tags during loading. Effective tags = root tags + entity tags.

**Common tag patterns:**
- DDD tactical: `aggregate-root`, `value-object`, `entity`, `domain-service`
- DDD strategic: `core-domain`, `support-domain`, `generic-domain`
- Audience: `consumer-facing`, `internal`, `partner-api`
- Lifecycle: `draft`, `stable`, `deprecated`
- Priority: `critical`, `important`, `nice-to-have`
- Domain slice: `order-domain`, `payment-domain`, `shipping-domain`

---

## 15. Multi-File Loading

Blueprint files can be split into multiple sub-files per schema type within a domain slice.

**Pattern A — Single file per type:**
```
orders/
  concepts.yaml
  domain.yaml
  rules.yaml
  story.yaml
```

**Pattern B — Multiple sub-files per type:**
```
orders/
  consumer.concepts.yaml
  organization.concepts.yaml
  domain.yaml
  checkout.story.yaml
  fulfillment.story.yaml
```

**File naming:** `{descriptive-name}.{schema-type}.yaml` (e.g. `consumer.concepts.yaml`). Schema types: concepts, domain, rules, models, story, dynamics, quality, infrastructure, arch, motivation, capability, decisions, test-cases.

**Loader behavior:** All files of the same schema type within a slice are merged. Root-level tags from each file apply to entities in that file. Per-file and per-slice validation (unique IDs, resolvable refs) applies.

---

## 16. Minimum Viable Blueprint per Target

| Target | Minimum schemas needed |
|--------|------------------------|
| OpenAPI | domain.yaml + models.yaml + arch.yaml (contracts) |
| AsyncAPI | domain.yaml + models.yaml + arch.yaml (contracts) |
| Event Storming | domain.yaml (with produces/reacts_to) + concepts.yaml (actors) |
| BPMN | story.yaml (with process) + domain.yaml (with causal links) + concepts.yaml (actors) |
| Context Map | arch.yaml (parties, contexts, dependencies) |
| UML State | concepts.yaml (states) + rules.yaml (transitions) |
| UML Sequence | story.yaml + arch.yaml (contracts) |
| ADR | decisions.yaml |
| Capability Map | capability.yaml |
| Arazzo | story.yaml + domain.yaml |
| Contract Tests | test-cases.yaml + domain.yaml + models.yaml |

---

## 17. Produces Convention

Commands typically produce events and/or documents. Events do not produce — they trigger reactions via `reacts_to` on other operations. Queries and documents typically do not produce. Validators WARN on non-conventional usage but do NOT reject.

| Pattern | Conventional? |
|---------|---------------|
| Command -> produces -> Event | Yes |
| Command -> produces -> Document | Yes |
| Event -> produces -> anything | Warning (validator warns) |
| Query -> produces -> anything | Warning (validator warns) |
| Document -> produces -> anything | Warning (validator warns) |

---

## 18. Validation and Quality Gates

Three deterministic checks, each answering a different question. They are ordered because each one assumes the previous passed — a semantic finding on an unparseable model is noise.

```bash
npm run validate .blueprint/v2.7 --schemas schema/v2.7   # is it legal?
npm run check    .blueprint/v2.7                          # is it connected?
npm run quality  .blueprint/v2.7                          # does it say anything?
```

| Tool | Question | Fails the build on |
|---|---|---|
| **validator** | Is this legal? | schema errors, unresolvable references |
| **semantic checker** | Is this connected? | any finding whose configured severity is `error` (none by default) |
| **quality gate** | Does it say anything? | nothing by default; threshold or baseline breach under `--strict` |

The default posture is deliberate: only the validator rejects out of the box. A newcomer's first model must be able to be small and thin without three tools shouting at it — the other two report until a project decides to gate.

### Validator — is it legal?

```bash
# Validate a blueprint directory
blueprint-validate .blueprint/v2.7

# Or via npm script
npm run validate -- .blueprint/v2.7
```

#### Errors (reject blueprint)
- Duplicate entity IDs within the same schema type in a slice
- Required fields missing (id, name, entry_operation on activities, etc.)
- Invalid ref patterns (ID doesn't match expected regex)
- Unresolvable refs (reference to non-existent entity)
- Schema validation failures (invalid enum values, wrong types)

#### Warnings (report but load)
- Story steps that don't match domain causal chain (steps are convenience view, not SoT)
- Non-conventional produces usage (event producing something, query producing, etc.)
- Operation with task_type=user-decision but no initiated_by referencing a human actor
- Orphaned entities (defined but never referenced)
- Activity with entry_operation that has no produces chain (single-step activity — might be intentional)

#### Info (log)
- File-level tags applied to entities (confirmation of inheritance)
- Multi-file aggregation count (e.g. "Loaded 3 concepts files into orders slice: 15 concepts total")

### Semantic checker — is it connected?

Structural findings a schema can never express: an entity nothing references, a command that produces no event, a rule no test validates, a question nothing answers. The rules are declarative YAML packs in `tools/semantic-checker/rules/`; that directory's README is the authoritative rule inventory, and it is machine-checked against the rule files themselves.

```bash
npm run check .blueprint/v2.7
npm run check .blueprint/v2.7 --config .blueprint-lint.yaml
node tools/semantic-checker/dist/cli.js --list          # every rule and its default severity
```

Severity per rule is a project decision, set in `.blueprint-lint.yaml`:

```yaml
rules:
  orphan-entities: warn
  missing-causal-links: error     # this project treats a missing causal link as fatal
  aggregate-root-signals: off
```

Four severities: `error` (exit 1), `warn`, `info`, `off`. Exit `0` passed (warnings and info may be present) · `1` at least one `error`-severity finding · `2` runner error.

Raising a rule to `error` is how a mature model locks in an invariant it has already satisfied. Doing it on a model that does not yet satisfy it just blocks the work; fix first, then ratchet.

### Quality gate — does it say anything?

The validator and the checker both pass on a model whose every description is missing. That model is legal, connected, and useless downstream: model properties become fields in generated OpenAPI contracts, so an undescribed property is a bare field in every generated client and every viewer. The quality gate measures **self-description coverage** — see [Self-Description and Examples](modeling-guide.md#self-description-and-examples) for what the bar is per entity type.

```bash
npm run quality .blueprint/v2.7                       # report; never fails
npm run quality .blueprint/v2.7 --strict              # release gate
npm run quality .blueprint/v2.7 --strict --since HEAD~1   # gate only what you changed
npm run quality .blueprint/v2.7 --json worklist.json  # machine-readable backfill worklist
```

Exit `0` clean · `1` threshold or baseline breach under `--strict` · `2` usage or configuration error.

#### Covered, filler, missing

Every observed field resolves into exactly one of three states:

| State | Meaning |
|---|---|
| **covered** | present and substantive |
| **filler** | present but says nothing — a placeholder, or prose that merely restates the field name |
| **missing** | absent or blank |

`filler` exists because a presence-only check is gameable by construction: `description: "The criteria field."` turns a presence check green and leaves the generated contract exactly as bare as before. Filler counts against a metric exactly like missing, and the report keeps them apart because they need different fixes — missing needs authoring, filler needs someone to notice that the gate was answered rather than the question. The rules behind it are deterministic (minimum length, a placeholder denylist, and an echo check that normalizes case, punctuation and articles before comparing prose against the name it describes). No model is involved.

#### Three ways to gate

| Mechanism | Question it answers | Where it is set |
|---|---|---|
| `threshold` | Is this model good enough to release? | `quality-spec.yaml`, corpus-calibrated |
| `patch_threshold` | Is the work being authored *right now* good enough? | `quality-spec.yaml`, higher than `threshold` |
| `baseline` | Has this model got worse? | `.blueprint-quality.yaml`, ratchets upward only |

The distinction matters most on an existing model. One sitting at 19% property-description coverage can never pass an 85% absolute bar, so an absolute-only gate gets switched off and stops doing anything at all. With `--since`, that same model is still required to write its *next* property properly, and the baseline stops the overall number sliding.

#### Per-project configuration

`.blueprint-quality.yaml`, discovered in the model root or up to three directories above it:

```yaml
thresholds:
  model.property.description: 0.70   # this project holds itself to a higher bar

baseline:                            # written by --update-baseline
  model.property.description: 0.842

deferrals:
  - metric: domain.command.exchange
    reason: >-
      No wire bindings authored yet; backfill tracked in MIG012.
    expires: 2026-10-31
```

A deferral **must** carry both a `reason` and an `expires` date. A deferral without a reason is just a disabled check; one without an expiry becomes permanent. Missing either is a configuration error (exit 2). Past its expiry the tool warns loudly but does not fail.

Metrics whose calibration sample was too thin ship with `threshold: null`: they still report and still ratchet, but they do not gate.

#### What the report tells a QA reader

Two metrics are read most often from outside the modeling team. `user_story.acceptance_criteria` is the one that decides whether test cases can be derived at all — a user story without acceptance criteria has nothing a test can assert against, and `user-story-without-acceptance-criteria` names each one. `test_case.provenance` shows whether the test cases in the model record where they came from (derived from a rule, written by hand, imported), which is what makes a coverage claim auditable rather than asserted. `--json` emits per-finding records, so "which stories are not yet testable" is a query, not a reading exercise.

### Definition of done for a slice

> A slice is done when the validator is green, the semantic checker reports no new findings, and the quality gate is clean for the files the slice touched (`--since <base-ref> --strict`) — or every remaining gap is recorded in `.blueprint-quality.yaml` as a deferral with a reason and an expiry date.

Note what that does *not* say: the whole model never has to be clean. On an existing model that bar is unreachable, and an unreachable bar gets switched off. The slice is accountable for the slice. Deferring is legitimate; deferring silently is not.

---

## 19. Migrations

Migrations are versioned, ordered changes to a blueprint **model** — not schema migrations (handled by `blueprint.changelog`). Schema evolution != model evolution.

**When to use migrations vs direct edit:** Use migrations when you need AS-IS vs TO-BE comparison, traceability to decisions, reversibility, or incremental evolution through ordered changes. Use direct edit when you are authoring the current (AS-IS) model and need no history or rollback. Migrations add overhead; reserve them for deliberate model evolution.

### When to use migrations

| Scenario | Approach |
|----------|----------|
| Schema format changes (field rename, structure) | `blueprint.changelog` + migration scripts |
| Model content changes (add concept, split aggregate, bulk tag) | Migrations |
| Direct edit of AS-IS model | Manual edit; no migration needed |
| AS-IS vs TO-BE comparison | Migrations with `status: pending` |

Use migrations when you want: two-state generation (AS-IS vs TO-BE), traceability to decisions, reversibility, or incremental model evolution through ordered changes.

### Migration lifecycle

```
draft -> pending -> applied
                 -> rolled-back
```

- **draft**: Authoring. Not visible to generators.
- **pending**: Ready for review. TO-BE generators include pending migrations.
- **applied**: Committed to AS-IS model. Changes are now in the base model.
- **rolled-back**: Reverted. Model returns to pre-migration state.

### Loader modes

| Mode | Behavior |
|------|----------|
| **as-is** | Load base blueprint only. Ignore all migrations. Generate from current committed state. |
| **to-be** | Load base model, then apply all `pending` migrations in dependency order. Generate from projected future state. |
| **point-in-time** | Load base model, apply migrations up to a specified migration ID. Reconstruct historical state. |

### Migration file structure

Four change collections:

| Collection | Purpose |
|------------|---------|
| **entities** | Add, remove, deprecate, split, or merge whole entities (concepts, operations, rules, etc.). |
| **properties** | Set, unset, rename, append, or remove-item on existing entity fields. |
| **relationships** | Add, remove, redirect, or modify edges between entities (produces, reacts_to, governed_by, etc.). |
| **meta** | Tag operations, bulk-tag, reclassify, move-to-slice, constitution-amend, or note (informational). |

**Atomic groups:** Changes with the same `group` must apply together or not at all. Groups are local to one migration.

**Ordering:** Use `order` (lower = first) within a migration. Changes without `order` apply after ordered ones.

**Targeting:** Migration `target` fields support three patterns:
- **Typed ref:** `CN005`, `CMD012`, `SR003` — entity-level within current scope
- **SpecPath:** `orders/domain/operations/CMD005` — unambiguous cross-slice targeting
- **Comma-separated:** `CN005,CN006` — for merge operations (multiple sources become one)

### Migration pre-application validation

Before applying a pending migration, the loader validates:

**Errors (reject):** `depends_on` references non-existent or draft/rolled-back migration; circular `depends_on`; add targets existing ID; modify/remove targets non-existent ID; `before` mismatches current state; duplicate edge on add; remove/redirect targets non-existent edge; same entity+property modified by two migrations without `depends_on`; applied result fails schema validation.

**Warnings (report, allow):** remove without `before`; set on new property without `old_value`; no `related_decisions`; no `rationale`; bulk-tag with broad filter.

**Atomic groups:** All changes with the same `group` succeed or all fail. Groups are local to one migration.

**Conflict detection:** Different properties on same entity -> no conflict. Same property -> conflict unless `depends_on` orders. Remove + modify same entity -> conflict.

### Migration file convention

```
.migrations/
  001-add-payment-retry.migration.yaml
  002-split-order-aggregate.migration.yaml
  003-tag-payment-operations.migration.yaml
```

Pattern: `{id}-{name}.migration.yaml` (e.g., `001-add-payment-retry.migration.yaml` or `MIG001-add-payment-retry.migration.yaml`). Loader discovers from `migrations[]` in blueprint or `.migrations/` directory. Root `.migrations/`; slice-scoped: `orders/.migrations/`. Dot-prefix distinguishes from domain-slice folders.

### Example 1: Add concept and connect it

```yaml
migration:
  id: MIG001
  name: add-payment-retry-concept
  date: "2026-02-18"
  status: pending
  description: "Add PaymentRetry concept and Retry Payment command with exponential backoff."
  related_decisions: [D012]
  rationale: "Payment gateway timeouts require structured retry logic. See ADR D012."
  tags: [payment, reliability]

changes:
  entities:
    - kind: add
      entity_type: concept
      target: CN025
      description: "New concept for payment retry attempt."
      after:
        id: CN025
        term: "PaymentRetry"
        summary: "Tracked payment retry attempt."
        definition: "A tracked attempt to re-process a failed payment with backoff strategy."
        states: [scheduled, in-progress, succeeded, exhausted]
        initial_state: scheduled
        terminal_states: [succeeded, exhausted]
      reason: "Payment failures need structured retry tracking."

    - kind: add
      entity_type: operation
      target: CMD050
      description: "Command to initiate a payment retry."
      after:
        id: CMD050
        name: "Retry Payment"
        kind: command
        task_type: automated
        description: "System retries a failed payment with exponential backoff."
      reason: "Automated retry on payment failure."

  relationships:
    - kind: add
      subject: CMD050
      predicate: reacts_to
      object: EVT005
      edge_properties:
        policy: "Retry failed payments up to 3 times"
        condition: "retry_count < 3"
      description: "Retry command reacts to PaymentFailed event."

    - kind: add
      subject: CMD050
      predicate: produces
      object: EVT004
      edge_properties:
        mode: one_of
      description: "Retry can produce PaymentConfirmed on success."

  properties:
    - kind: set
      target: EVT005
      entity_type: operation
      property: description
      value: "Fact: payment authorization was declined. Triggers retry logic if retry count not exhausted."
      old_value: "Fact: payment authorization was declined."
      description: "Update PaymentFailed description to reference retry."

rollback:
  automatic: true
  data_loss: false
```

### Example 2: Split an aggregate

```yaml
migration:
  id: MIG002
  name: split-order-aggregate
  date: "2026-02-20"
  status: draft
  description: "Split Order into Order (header) and OrderLineItem (detail) for partial fulfillment."
  depends_on: [MIG001]
  related_decisions: [D015]
  breaking: true
  semver_impact: major
  rationale: "Current Order aggregate too large. Partial fulfillment requires line-item granularity."

changes:
  entities:
    - kind: split
      entity_type: concept
      target: CN001
      description: "Split Order into Order and OrderLineItem."
      before:
        id: CN001
        name: "Order"
        definition: "A customer's purchase request including all line items."
        properties:
          total_amount: "decimal"
          status: "string"
          items: "array of line items"
      after:
        - id: CN001
          term: "Order"
          summary: "Purchase request header."
          definition: "Purchase request header. Order-level data only."
        - id: CN030
          term: "OrderLineItem"
          summary: "Single product line."
          definition: "Single product line. Independently fulfillable."
      reason: "Enable partial fulfillment at line-item level."
      group: "order-split"

  relationships:
    - kind: add
      subject: CN001
      predicate: contains
      object: CN030
      description: "Order contains OrderLineItems."
      group: "order-split"

  meta:
    - kind: tag-add
      target: CN030
      value: "aggregate-root"
      description: "OrderLineItem becomes its own aggregate root."
      group: "order-split"

rollback:
  automatic: true
  data_loss: false
  warnings:
    - "If generators produced artifacts from TO-BE state, those artifacts reference CN030 which will not exist after rollback."
```

### Example 3: Bulk tagging

```yaml
migration:
  id: MIG003
  name: tag-payment-operations
  date: "2026-02-22"
  status: pending
  description: "Tag all payment-related operations for upcoming payment microservice extraction."
  tags: [payment, extraction-prep]

changes:
  meta:
    - kind: bulk-tag
      target: "payment-domain"
      value: "extraction-candidate"
      filter:
        entity_type: operation
        slice: payments
      description: "Mark all payment operations as extraction candidates."

    - kind: note
      target: "MIG003"
      value: "This migration prepares for payment service extraction planned in Q3. No model changes — tagging only."
      description: "Documentation note for reviewers."

rollback:
  automatic: true
  data_loss: false
```

### Migration validation rules (loader)

**Errors (reject):** Circular `depends_on`; migration targets non-existent entity; `before`/`old_value` mismatch (conflict); duplicate edge; schema validation failure after apply.

**Warnings (allow):** `remove` without `before` (incomplete rollback); missing `related_decisions`; broad bulk-tag filter.

---

## 20. Schema Evolution

| Version | Date | Summary |
|---------|------|---------|
| v2.0.0 | 2025-12-01 | Initial release: metamodel, domain, concepts, rules, arch, story, motivation, decisions, test-cases, capability, dynamics, quality, models, migration |
| v2.1.0 | 2026-01-15 | Domain dictionaries, produces/reacts_to, tags, story activities, models purpose, fitness functions, constitution |
| v2.2.0 | 2026-02-01 | Concept attributes (CAT###), model represents, story IDs (STR###), organization (PRT/DPT/TM), interactions (SCR/UAC/UNV), owned_by, expanded decision impact and test validates, multi-protocol exchange, typed contracts |
| v2.3.0 | 2026-02-15 | Properties extension bag, name/description primacy, progressive enrichment |
| v2.4.0 | 2026-03-01 | Concept stereotypes, code_refs (28 entities), domain questions (QN###), operation examples, servers[], GraphQL protocol/contracts, idempotency, correlation, repository config |
| v2.5.0 | 2026-03-15 | User stories (US###), use cases (UC###), milestones (MS###), persona on actors, question enrichment, risk enrichment, delivery priority (MoSCoW), design references, roadmap schema |
| v2.6.0 | 2026-03-19 | Value streams (VS###), personas 1:many, read-model stereotype, materializes, enum transitions, evidence chains, CAT### context prefix |
| v2.7.0 | 2026-05-26 | Rename acronym files: rg->infrastructure, ui->interactions, org->organization |

---

## 21. CHANGELOG: v2.3 -> v2.4

### New Metamodel Definitions
- `question_ref` (QN###): Typed domain question IDs
- `code_refs`: Array of `{path, role, description}` for source code traceability
- `repository`: Blueprint-level `{url, branch, provider}` for constructing clickable code links
- `concept_stereotype`: Enum for DDD classification (`entity`, `value-object`, `aggregate-root`, `domain-service`, `specification`)
- `correlation_id`: Object `{location, description}` for distributed tracing
- `server`: Object `{url, description, environment}` for API endpoint definitions

### Non-Breaking Additions
- **Concepts**: `stereotype` enum for explicit DDD classification (entity, value-object, aggregate-root, domain-service, specification)
- **Domain**: `questions[]` — first-class competency questions with `answered_by`, `concepts`, `motivated_by`, `stakeholders`
- **Domain**: `examples[]` on operations — Pact-style contract test scenarios with `provider_state`, `request`, `response`, `response_code`
- **Domain**: `idempotency_key` on commands for safe retries
- **Domain**: `correlation_id` on operations for distributed tracing
- **Domain**: `graphql` protocol with `{field, type}` exchange binding
- **Arch**: `servers[]` on services — API endpoint URLs with environment
- **Arch**: `graphql` contract type alongside `openapi` and `asyncapi`
- **Blueprint**: `repository` configuration for code reference URL construction
- **All 28 eligible entities**: Optional `code_refs[]` linking blueprint entities to source code (excludes motivation, capability, org entities)

### Domain Dictionaries & Arch Restructure
- **Domain**: `operations` changed from array to **dictionary** keyed by camelCase name (e.g. `submitOrder: { id: CMD001, ... }`). Keys derived from operation `name` field. Each operation retains required `id` for machine-stable cross-file references.
- **Domain**: `errors` changed from array to **dictionary** keyed by camelCase name (e.g. `orderValidationFailed: { id: ERR001, ... }`). Same dual-ref pattern as operations.
- **Metamodel**: `operation_ref` supports **dual format** — ID-based (`orders.CMD001`) and domain:key (`orders:submitOrder`). Both are valid; ID-based is machine-stable, domain:key is human-readable.
- **Metamodel**: `error_ref` supports the same dual format as `operation_ref`.
- **Arch**: Root-level arch files describe systems and MUST NOT declare `scope`. File name identifies the system (e.g. `eshop.arch.yaml`).
- **Arch**: Contract `expose`/`send`/`receive`/`call` arrays migrated from ID-based refs (`orders.CMD001`) to domain:key refs (`orders:submitOrder`).
- **Quality**: SLO and metric `operations` arrays migrated to domain:key format.

### Breaking Changes
- **Domain**: `operations` and `errors` changed from array to dictionary. Existing array-format files must be converted. The `id` field is preserved on each entry; camelCase keys are derived from the `name` field.
- **Arch**: Expose/send/receive/call refs in arch contracts changed from `{context}.{ID}` format to `{domain}:{key}` format. Both formats validate against the updated `operation_ref` schema, but all example and project files have been migrated.

### Migration Notes
**Operations/errors**: Convert array items to dictionary entries. For each operation, derive a camelCase key from the `name` field (e.g. "Submit Order" -> `submitOrder`), then nest the operation under that key. The `id` field is preserved.

**Arch refs**: Update all `expose`, `send`, `receive`, and `call` arrays from `{context}.{ID}` to `{domain}:{key}` format (e.g. `orders.CMD001` -> `orders:submitOrder`). Build the mapping from domain.yaml operation keys.

**Quality refs**: Update SLO and metric `operations` arrays from ID-based to domain:key format.

**Additive v2.4 features**: add `stereotype` to concepts, add `code_refs` to entities, add `questions[]` to domain.yaml, add `repository` to blueprint.yaml, add `servers[]` to services in arch.yaml, add `examples[]` to operations.

---

## 22. CHANGELOG: v2.4 -> v2.5

### New Metamodel Definitions
- `user_story_ref` (US###): Typed user story IDs (3+ digits)
- `use_case_ref` (UC###): Typed use case IDs (3+ digits)
- `milestone_ref` (MS###): Typed milestone IDs (3+ digits)
- `delivery_priority`: MoSCoW enum (`must-have`, `should-have`, `could-have`, `wont-have`)
- `release_target`: Free-form string for release/milestone labels

### New Schema File
- **Roadmap** (`governance/roadmap.schema.yaml`): `milestones[]` (MS###) with `target_date`, `status`, `deliverables[]` (polymorphic kind+ref), `success_criteria[]`, `dependencies[]`

### Non-Breaking Additions
- **Story**: `user_stories[]` (US###) — Agile user stories with actor, goal, benefit, acceptance_criteria, delivery_priority, release_target, status
- **Story**: `use_cases[]` (UC###) — dual-mode use cases: functional (operation per step) and journey (screen + emotion + pain_point per step)
- **Concepts**: `persona` on actors — goals, pain_points, behaviors, tech_savviness, job_to_be_done, context, demographics
- **Domain**: Question enrichment — `owner` (actor_ref), `blocking`, `due_date`, `resolution`, `resolved` + expanded `category` enum (7->14 values)
- **Domain**: Operation `delivery_priority` (MoSCoW) + `release_target`
- **Motivation**: Risk enrichment — `contingency`, `owner` (actor_ref), `status` (5-value lifecycle), `review_date`
- **Capability**: `delivery_priority` (MoSCoW), orthogonal to existing `strategic_importance`
- **Interactions**: `design_references` — `figma_url`, `storybook_url`, `design_system`, `prototype_url`, `accessibility_standard` (WCAG enum)
- **Blueprint**: `governance.roadmap` reference

### Breaking Changes
None. All changes are additive (new optional fields, new optional arrays, new optional file).

### Migration Notes
No action required. Existing v2.4 blueprints validate against v2.5 without modification.

---

## 23. PRD Mapping

Blueprint sections map to PRD (Product Requirements Document) sections:

| PRD Section | Blueprint Source |
|-------------|----------------|
| Executive Summary | `blueprint.yaml` name + description |
| Stakeholders | `concepts.yaml` actors[] |
| User Stories | `story.yaml` user_stories[] (US###) |
| Use Cases | `story.yaml` use_cases[] (UC###) |
| Personas | `concepts.yaml` actors[].persona |
| Functional Requirements | `domain.yaml` operations{} |
| Business Rules | `rules.yaml` rules[] |
| Non-Functional Requirements | `quality.yaml` metrics/KPIs/SLOs |
| Architecture | `arch.yaml` contexts/services |
| Timeline / Milestones | `roadmap.yaml` milestones[] (MS###) |
| Risks | `motivation.yaml` risks[] |
| Open Questions | `domain.yaml` questions[] (QN### with blocking/resolution) |
| Design References | `interactions.yaml` design_references |
| Decisions | `decisions.yaml` decisions[] |
| Capabilities | `capability.yaml` capabilities[] |

---

## 24. v2.5 New Fields

### User Stories (`story.schema.yaml`)

New optional `user_stories[]` array in story.yaml, alongside existing `stories[]`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `user_story_ref` | Yes | US### pattern |
| `actor` | `actor_ref` | Yes | "As a..." clause |
| `goal` | string | Yes | "I want..." clause |
| `benefit` | string | No | "So that..." clause |
| `acceptance_criteria` | string[] | No | Gherkin or plain-language |
| `delivery_priority` | enum | No | MoSCoW: must-have, should-have, could-have, wont-have |
| `release_target` | string | No | Target release label |
| `story_points` | integer | No | Effort estimate |
| `status` | enum | No | draft, refined, ready, in-progress, done, deferred |
| `use_case` | `use_case_ref` | No | Back-pointer to parent UC |
| `operations` | operation_ref[] | No | Domain operations exercised |
| `test_cases` | test_ref[] | No | Validating test cases |

### Use Cases (`story.schema.yaml`)

New optional `use_cases[]` array with dual-mode steps:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `use_case_ref` | Yes | UC### pattern |
| `name` | string | Yes | Use case name |
| `primary_actor` | `actor_ref` | Yes | Initiating actor |
| `main_scenario` | step[] | No | Ordered steps |
| `extensions` | extension[] | No | Alternative flows |
| `user_stories` | user_story_ref[] | No | Grouped stories |
| `stories` | story_ref[] | No | Implementing STR### stories |
| `delivery_priority` | enum | No | MoSCoW |
| `release_target` | string | No | Target release |

Step fields (all optional except `step` + `action`):
- `operation`: operation_ref — functional mode
- `screen`: screen_ref — journey mode
- `emotion`: enum (frustrated, confused, neutral, satisfied, delighted) — empathy mapping
- `pain_point`: string — UX friction

### Milestones (`governance/roadmap.schema.yaml`) — NEW FILE

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `milestone_ref` | Yes | MS### pattern |
| `name` | string | Yes | Milestone name |
| `target_date` | date (ISO 8601) | Yes | Delivery target |
| `status` | enum | No | planned, in-progress, achieved, deferred, cancelled |
| `deliverables` | object[] | No | kind (enum) + ref (string) + description |
| `success_criteria` | string[] | No | Measurable criteria |
| `dependencies` | milestone_ref[] | No | Prerequisite milestones |

Deliverable `kind` enum: `capability`, `user-story`, `use-case`, `operation`, `migration`.

### Persona on Actor (`concepts.schema.yaml`)

Optional `persona` block on actor entities:

| Field | Type | Description |
|-------|------|-------------|
| `quote` | string | Representative user quote |
| `goals` | string[] | What the persona tries to achieve |
| `pain_points` | string[] | Current frustrations |
| `behaviors` | string[] | Observable workflow patterns |
| `tech_savviness` | enum | low, medium, high, expert |
| `job_to_be_done` | string | JTBD-style core job |
| `context` | string | Typical environment |
| `demographics` | object (open) | role, industry, team_size, custom keys |

### Question Enrichment (`domain.schema.yaml`)

New optional fields on existing `question` $def:

| Field | Type | Description |
|-------|------|-------------|
| `owner` | `actor_ref` | Person driving resolution |
| `blocking` | boolean (default: false) | Blocks downstream work |
| `due_date` | date (ISO 8601) | Resolution target |
| `resolution` | string | Answer when resolved |
| `resolved` | boolean (default: false) | Whether resolved |

Expanded `category` enum (14 values): existence, enumeration, relationship, measurement, temporal, behavioral, compliance, **business**, **technical**, **ux**, **legal**, **data**, **dependency**, **feasibility**.

### Risk Enrichment (`governance/motivation.schema.yaml`)

New optional fields on existing `risk` $def:

| Field | Type | Description |
|-------|------|-------------|
| `contingency` | string | Fallback if mitigation fails |
| `owner` | `actor_ref` | Individual responsible |
| `status` | enum | identified, open, mitigated, accepted, closed |
| `review_date` | date (ISO 8601) | Reassessment date |

### Design References (`design/interactions.schema.yaml`)

Optional `design_references` object on interactions.yaml root:

| Field | Type | Description |
|-------|------|-------------|
| `figma_url` | string | Figma file link |
| `storybook_url` | string | Storybook link |
| `design_system` | string | Design system name/URL |
| `prototype_url` | string | Prototype link |
| `accessibility_standard` | enum | WCAG-2.0-AA, WCAG-2.1-AA, WCAG-2.2-AA, WCAG-2.1-AAA |

### Delivery Priority (cross-cutting)

`delivery_priority` (MoSCoW) added to operations, capabilities, user stories, and use cases. `release_target` (free-form string) added to the same entities.

**Important:** `delivery_priority` (MoSCoW for release planning) is distinct from `priority` on questions (urgency of knowledge gap).

---

## 25. v2.7.2 New Fields

### Roadmap Work Items (`governance/roadmap.schema.yaml`)

The roadmap gains an execution-tier **work breakdown (WBS)** below milestones — the structure a Gantt view renders as lanes and child bars. Milestones (`MS###`, dated releases) are unchanged; work items (`WI###`) are the new tier. Existing milestone-only roadmaps continue to validate (all additions are optional).

**Sprint cadence (optional, roadmap root):**

| Field | Type | Description |
|-------|------|-------------|
| `cadence.anchor_sprint` | integer | Sprint number of the anchor point |
| `cadence.anchor_start` | date | ISO date the anchor sprint starts |
| `cadence.sprint_length_days` | integer | Sprint length in days |

When `cadence` is set, work items may be placed by sprint number; dates derive as `anchor_start + (sprint − anchor_sprint) × sprint_length_days`.

**Work items (`work_items[]`, recursive via `children`):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `WI\d{3,}` | Work-item identifier (`WI001`) |
| `kind` | enum | epic, phase, foundation, subscope, task |
| `name` / `description` | string | Title and detail |
| `status` | enum | planned, in-progress, achieved, deferred, cancelled (lifecycle) |
| `confidence` | enum | committed, estimated, tentative (planning confidence — orthogonal to `status`) |
| `progress` | integer 0–100 | Percent complete |
| `milestone` | `MS\d{3,}` | The release this rolls up to |
| `start_sprint` / `end_sprint` | number | Sprint placement (fractional allowed: `30.5`) |
| `start_date` / `end_date` | date | Explicit dates (override sprint placement) |
| `buffer_end_sprint` / `buffer_end` | number / date | Buffer tail after the committed end |
| `owned_by` | owned_by | Typed org owner (team / department / party) |
| `executor` | string[] | Human owner name(s), distinct from typed `owned_by` |
| `tracker_ref` | string | External issue-tracker key/URL (base-URL construction is a view concern) |
| `depends_on` | (`WI` \| `MS`)[] | Predecessor work items or milestones |
| `blockers` | (string \| {text, tracker_ref, blocked_by})[] | Active blockers |
| `children` | work_item[] | Nested subscopes / tasks |

**Typed relations (on both `milestone` and `work_item`):**

| Field | Target | Meaning |
|-------|--------|---------|
| `advances_goals` | `G\d{3}` | Motivation goals advanced |
| `mitigates_risks` | `R\d{3}` | Motivation risks mitigated |
| `realizes_decisions` | `D\d{3}` | Decisions (ADR) realized |
| `value_streams` | `VS\d{3,}` | Value streams contributed to |
| `user_stories` | `US\d{3,}` | User stories delivered |
| `use_cases` | `UC\d{3,}` | Use cases delivered |

**Views vs structure.** Pure-rendering concerns (tracker base URL, axis bounds, marker / "today" lines, colours, hatching) are **not** modelled here — they belong to a Gantt *view-config*. The roadmap is the single source of truth; the Gantt is a derived view.
