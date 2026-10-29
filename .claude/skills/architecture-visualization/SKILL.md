---
name: architecture-visualization
description: Architecture visualization and communication methods. Use when documenting architecture, recording decisions, communicating to stakeholders, or when C4, ArchiMate, arc42, ADRs, risk analysis, ATAM, or risk storming are relevant.
---

# Architecture Visualization & Communication

Answer: *How do we communicate the architecture to different audiences at the right level of abstraction?*

Use this skill when producing arch.yaml, decisions.yaml, or when recording design trade-offs and rationale. **Core to the original 5:** Risk Analysis & Architectural Decision Making.

---

## Methods (Original 5)

### Risk Analysis & Architectural Decision Making
ADRs (Context → Decision → Status → Consequences), ATAM, risk storming. Captures *why* decisions were made.

**When:** Always. Every architectural decision should have an ADR. Combine with Y-statements for rigor.

---

## Methods (Extended)

### C4 Model (Simon Brown)
Four levels: Context → Containers → Components → Code. Solves "random boxes and arrows." Shared vocabulary at different zoom levels.

**When:** Every software project. Combines with Structurizr, Mermaid.

**Best sources:**
- https://c4model.com/ - Official site
- https://www.codingthearchitecture.com/ - Simon Brown
- https://www.infoq.com/articles/C4-architecture-model/ - InfoQ article

### ArchiMate (The Open Group)
Standardized modeling across Business, Application, Technology layers. Traceability from capability to application to infrastructure.

**When:** Enterprise-scale governance, transformation roadmaps. Overkill for single-team projects.

**Best sources:** https://www.opengroup.org/archimate-forum

### arc42 (Gernot Starke, Peter Hruschka)
12-section template: constraints, runtime views, deployment. Lean, process-agnostic, actually maintained.

**When:** Any project needing architecture documentation. Works with C4 inside sections.

**Best sources:** https://arc42.org/

### Architecture Decision Records (Michael Nygard)
Lightweight, immutable: Context → Decision → Status → Consequences. Stored alongside code.

**When:** Always. Prevents re-litigating debates; new members understand history.

**Best sources:**
- https://adr.github.io/
- Michael Nygard - original ADR concept

---

## Blueprint Integration

- **arch.yaml** - Bounded contexts, services, contracts, inter-context dependencies
- **decisions.yaml** - ADR log with motivation_refs, capability_refs; supersedes/superseded_by as arrays
- **motivation.yaml** - Goals, risks, assumptions feeding decision rationale

### Context map & ownership (v2.7.6+ - current)

Since v2.7.6 the arch hierarchy is referenceable typed nodes and the context map is
keyed on them:

- **Typed ids** `party.id` (`PRT###`) → `context.id` (`BC###`) → `service.id` (`SVC###`), inline on the
  nested hierarchy, **scope-prefixed** (`catalog.BC001`). Inter-context edges reference the target by
  `dependency.bounded_context_ref: BC###` (id-based), not a name string.
- **What lives in a context is DERIVED from its service contracts** - an operation a service `expose`s/
  `send`s is *handled by* that context (the context-map "sticky"). Do **not** hand-declare operation
  ownership on the domain file (there is no `bounded_context_ref` there for operations); a context whose
  services expose no ops renders empty - model its contracts, don't fake the ownership. Competency
  **questions** may carry `bounded_context_ref: BC###` (the one explicit domain→BC ref); concepts stay
  many-to-many. These are additive and optional on v2.7.x, and live since v2.7.6.

### Infrastructure layer - the deployment projection (v2.7.7+)

`infrastructure.yaml` is a **first-class typed graph**, so it renders like the arch layer - nodes and
typed edges, not a properties bag. This is the deployment / technology view (C4 Deployment diagram,
ArchiMate Technology layer), and it is a *different question* from the context map: arch says who owns
what, infrastructure says where it runs.

- **Nodes:** `IR###` (resource) · `ENV###` (environment) · `RT###` (resource type, from the profile
  catalog rather than your model) · `BND###` (type × environment binding) · `DSC###` (deployment scope).
  Scope-prefixed like everything else (`ops.IR001`).
- **Two kinds of edge - keep them visually distinct.** The five TOSCA verbs carry causality and
  placement (`hosted_on` · `connects_to` · `depends_on` · `attaches_to` · `routes_to`); the
  scope-membership edges (`grouped_in` · `nested_in` · `targets_scope`) are deliberately **not** TOSCA,
  because grouping is not a dependency. Draw scope as a container or boundary and TOSCA as arrows -
  blast radius follows the arrows and must never leak across a boundary.
- **`scope_ref` and `hosted_on` are both needed, and drawing only one hides something.** A database
  grouped in its own resource group yet hosted on shared compute needs the boundary *and* a placement
  arrow crossing it: drop the boundary and you lose the cost/ownership story, drop the arrow and you
  lose the shared-compute coupling.
- **Posture worth surfacing:** `exposure` (public / internal / dmz / private / air-gapped / vpn-only /
  peered), the cross-cutting `identity` / `access[]` / `observability` / `redundancy` /
  `encryption_key` blocks, and `connections` as first-class edges - a connection implies both wiring
  and access grants, so it belongs on the diagram rather than in a note.
- **A replication check you can compute:** if a logical service A depends on B, then in every
  environment the realizing resources need a corresponding link - or an explicit waiver. That is a
  coverage question, not a diagram nicety, and it is the kind of thing worth failing a review over.
