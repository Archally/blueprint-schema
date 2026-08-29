# Blueprint File Conventions

Practical rules for organizing `.blueprint/` directories. These conventions apply to any project using the schema, regardless of size.

## Directory Structure

```
my-project/
  .blueprint/v2.7/
    blueprint.yaml              # Required: name, version
    README.md                   # Optional: project description

    # Root-level files (shared/system-level only)
    arch.yaml                   # System architecture, context map, inter-domain dependencies
    motivation.yaml             # System-wide goals, risks
    decisions.yaml              # System-wide ADRs
    organization.yaml           # Organizational hierarchy
    capability.yaml             # Business capability map
    value-stream.yaml           # End-to-end value flows
    roadmap.yaml                # Milestones

    # Domain slices (one per business domain)
    catalog/
      concepts.yaml
      domain.yaml
      arch.yaml                 # Catalog-specific services, contracts, dependencies
      rules.yaml
      story.yaml
      test-cases.yaml
    orders/
      concepts.yaml
      domain.yaml
      arch.yaml                 # Orders-specific services and contracts
      models.yaml
      rules.yaml
      motivation.yaml           # Orders-specific goals distinct from system goals
      decisions.yaml            # Orders-specific ADRs
      story.yaml
      test-cases.yaml
    payments/
      concepts.yaml
      domain.yaml
      arch.yaml                 # Payments-specific services and contracts
      ...
```

The same schema type can appear at root level AND inside slices. Root-level files describe system-wide or cross-domain concerns; slice-level files describe domain-specific content. The loader treats them as separate scopes — no merging across levels.

## Slices vs Bounded Contexts

A **slice** is a filesystem directory grouping artifacts by business domain (e.g., `orders/`, `payments/`). A **bounded context** is an architectural boundary defined in `arch.yaml` with relationships, classification, and team ownership.

They often map 1:1, but don't have to. A single business domain slice can contain multiple bounded contexts (e.g., `orders/` containing "order-placement" and "order-fulfillment" contexts defined in `arch.yaml`). The filesystem organizes by business domain; `arch.yaml` defines the architectural boundaries.

## When to Create Root-Level Files

Root-level files are for content that spans multiple slices or describes the system as a whole:

| File | Root-level when | Slice-level when |
|------|----------------|-----------------|
| `arch.yaml` | System architecture, context map, inter-domain dependencies | Domain-specific services, contracts, and internal dependencies |
| `motivation.yaml` | System-wide goals and risks | Domain has its own goals distinct from system |
| `decisions.yaml` | System-wide ADRs | Domain-specific architectural decisions |
| `quality.yaml` | System-wide SLOs/SLAs | Domain-specific metrics |
| `capability.yaml` | Enterprise capability map | Domain-scoped capabilities |
| `organization.yaml` | Organization hierarchy (always root) | Never |
| `value-stream.yaml` | Cross-domain value flows (always root) | Never |
| `roadmap.yaml` | System milestones (always root) | Never |

**Do not** create root-level `concepts.yaml`, `rules.yaml`, or `domain.yaml` unless they contain entities shared across multiple slices.

**When the same type appears at both levels:** root `arch.yaml` defines the system context map and inter-domain dependencies; `orders/arch.yaml` defines the services, contracts, and internal dependencies within that domain. They complement each other — root describes the forest, slices describe the trees.

## Where a Declaration Lives Is Part of What It Means

A model is read as a tree, and the first directory level is the slice. So a declaration's location is
not just filing: it states which slice owns the thing being declared.

- `orders/arch.yaml` declares services that belong to `orders`.
- A file at the model root belongs to **no** slice. That is what makes root-level content
  cross-cutting, and it is the point of the table above.

The consequence is worth stating plainly, because it is easy to meet by accident: **anything derived
from a declaration inherits that ownership.** A service declared at the root is owned by no slice, so
the contracts, models and diagrams derived from it are cross-cutting too, however domain-specific
their subject matter is.

That is correct when a root file genuinely describes the system. It is surprising when a root file
was chosen for a different reason, such as one architecture file per system in a large model, where
each file describes several slices at once.

### Saying it explicitly

A contract does not have to inherit. Its `output:` accepts three forms, and the schema carries the
full rule on the field itself:

| `output:` | Meaning |
|---|---|
| `orders-api.openapi` | belongs wherever the declaring file belongs |
| `orders/orders-api.openapi` | belongs to the `orders` slice, whatever file declares it |
| `_global/shared-events.asyncapi` | cross-cutting, stated rather than inferred |

A first segment naming no declared slice is reported rather than silently accepted, so a typo is
visible.

### Two ways to fix a root file that describes several slices

**Split it.** One architecture file per slice, each inside its slice directory. Ownership then
follows from the layout with nothing else to maintain, and every derived artifact is attributed
without a per-contract decision.

**Or state the exception.** Keep the file where it is and give each contract an explicit `output:`
prefix. Fewer files to move, but the ownership now lives in a field rather than in the structure, so
it has to be repeated for every contract added later.

Prefer the split when the file describes several slices. Prefer the prefix when one contract is the
exception to an otherwise cross-cutting file.

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Slice folders | kebab-case | `order-management/`, `user-identity/` |
| YAML files | `{schema-type}.yaml` | `concepts.yaml`, `domain.yaml` |
| Sub-files | `{semantic-prefix}.{schema-type}.yaml` | `consumer.concepts.yaml`, `checkout.story.yaml` |
| Entity IDs | `{PREFIX}{NNN}` or `{slice}.{PREFIX}{NNN}` | `CN001`, `orders.CMD001` |
| Operation dict keys | camelCase | `submitOrder`, `cancelOrder` |
| Property names | snake_case | `delivery_priority`, `task_type` |
| Enum values | kebab-case | `aggregate-root`, `very-low` |

## When to Split Files

Split a file when any of these apply:

- File exceeds **~150 lines** or **~15 entities**
- Content has **natural semantic clusters** (e.g., consumer-facing vs. internal operations)
- **Different teams** own different subsets
- You want **filesystem structure to reveal domain structure**

### Sub-file naming pattern

`{semantic-prefix}.{schema-type}.yaml` — the prefix describes the cluster, the suffix identifies the schema type for the loader. This pattern works at **both** root level and inside slices.

**Inside a slice** — split by semantic cluster within the domain:

```
orders/
  checkout.domain.yaml          # Checkout-related operations
  fulfillment.domain.yaml       # Fulfillment-related operations
  consumer.concepts.yaml        # Customer-facing concepts
  internal.concepts.yaml        # Back-office concepts
  pricing.rules.yaml            # Pricing rules
  compliance.rules.yaml         # Regulatory rules
```

**At root level** — split system-wide files by concern:

```
.blueprint/v2.7/
  platform.arch.yaml            # Platform infrastructure services
  integrations.arch.yaml        # Third-party integration services
  revenue.capability.yaml       # Revenue-generating capabilities
  compliance.capability.yaml    # Regulatory capabilities
  infrastructure.decisions.yaml # Infrastructure ADRs
  security.decisions.yaml       # Security ADRs
```

**Examples by layer:**

| Base file | Splits into | Why |
|---|---|---|
| `concepts.yaml` | `consumer.concepts.yaml`, `organization.concepts.yaml` | Different actor perspectives |
| `domain.yaml` | `checkout.domain.yaml`, `fulfillment.domain.yaml` | Different process areas |
| `rules.yaml` | `pricing.rules.yaml`, `compliance.rules.yaml` | Different rule domains |
| `story.yaml` | `happy-path.story.yaml`, `error-handling.story.yaml` | Different flow types |
| `test-cases.yaml` | `checkout.test-cases.yaml`, `refund.test-cases.yaml` | Different test scopes |
| `models.yaml` | `commands.models.yaml`, `read-models.models.yaml` | Different model purposes |
| `decisions.yaml` | `architecture.decisions.yaml`, `technology.decisions.yaml` | Different decision categories |

### How sub-file loading works

The loader merges all files of the same schema type within a slice. For example, `consumer.concepts.yaml` and `organization.concepts.yaml` both contribute to the slice's concept collection.

Root-level `tags` in each sub-file apply to all entities in that file — use them to identify the cluster:

```yaml
# consumer.concepts.yaml
tags: ["consumer-facing"]

concepts:
  - id: CN001
    name: "Order"
    # effective tags: ["consumer-facing"]
```

### When to keep a single file

Not every layer needs splitting. Keep a single file when:
- The slice has fewer than 15 entities of that type
- All entities belong to the same semantic cluster
- The file is under 150 lines

## ID Conventions

### Prefix by entity type

| Entity | Prefix | Phase |
|--------|--------|-------|
| Concept | CN | 1 |
| Actor | ACT | 1 |
| Command | CMD | 1 |
| Event | EVT | 1 |
| Query | QRY | 1 |
| Document | DOC | 1 |
| Story | STR | 1 |
| Activity | SA | 1 |
| User Story | US | 1 |
| Goal | G | 1 |
| Risk | R | 1 |
| Rule (structural) | SR | 1 |
| Rule (validation) | VR | 1 |
| Test (happy path) | TC | 1 |
| Concept attribute | CAT | 1 |
| Error | ERR | 2 |
| Question | QN | 2 |
| Model | MDL | 2 |
| Use Case | UC | 2 |
| Decision | D | 2 |
| Enumeration | EN | 2 |
| Capability | CAP | 3 |
| Value Stream | VS | 3 |
| Milestone | MS | 3 |
| Screen | SCR | 3 |
| Party | PRT | 3 |
| Team | TM | 3 |
| Migration | MIG | 4+ |

### Numbering

Use a **single counter across all operation kinds** within a slice. IDs reflect creation order, not kind-specific sequences. Gaps are expected:

```yaml
# CMD001, EVT002, CMD003, QRY004 — there is no CMD002
```

### Context prefix

Use `{slice}.{PREFIX}{NNN}` for cross-slice references: `orders.CN001`, `payments.CMD004`. Unprefixed IDs are resolved within the current slice.

## Minimal Valid Blueprint

The smallest valid blueprint — two files:

```yaml
# blueprint.yaml
version: "1.0.0"
name: "My Service"
```

```yaml
# concepts.yaml
version: "1.0.0"
concepts:
  - id: CN001
    name: "Order"
    stereotype: aggregate-root
    description: "A customer's purchase request."
```

Everything else is optional. Add files as your model grows through phases.
