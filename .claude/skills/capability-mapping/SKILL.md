---
name: capability-mapping
description: >
  Use when building a business capability map (stable "what the business can do", hierarchical,
  technology-independent) and value streams (end-to-end value flows across capabilities) in an
  Archally blueprint. Maps to capability.yaml (CAP) and value-stream.yaml (VS). Distinguishes
  capabilities (stable) from processes (how) and bounded contexts (implementation).
---

# Capability & Value-Stream Mapping for Blueprints

A **business capability** is a stable statement of *what* the business is able to do -
noun-phrased, technology- and process-independent ("Order Management", "Invoice Export").
It changes far more slowly than the processes or systems that realize it. A **value stream** is
the end-to-end sequence of stages that delivers value to a stakeholder, served by capabilities.

## Capability vs neighbors (don't conflate)
| Concept | Question it answers | Blueprint |
|---|---|---|
| Capability | *What* can the business do? (stable) | `capability.yaml` CAP |
| Process | *How*, in what order? | `story.yaml` process |
| Bounded context | *Where* is it implemented? | `arch.yaml` context |
| Value stream | *What end-to-end value*, to whom? | `value-stream.yaml` VS |

## `capability.yaml`
```yaml
capabilities:
  - id: CAP003
    name: "Order Management"              # noun phrase, stable
    level: 1                              # hierarchy depth (children: nested CAPs)
    description: "Capture and progress customer orders."
    strategic_importance: critical        # critical|high|medium|low
    delivery_priority: must-have          # MoSCoW (orthogonal to importance)
    goal_refs: [G004]                     # why it matters
    value_stream_refs: [VS001]            # which streams it serves
    operations: [checkout.CMD020]         # (later) how it's realized - domain ops
    children: [ … ]                       # sub-capabilities (level 2+)
```
- **Levels:** L1 = coarse business capability; L2/L3 = sub-capabilities. Keep the tree shallow
  early (MVB), deepen later.
- **Strategic importance ≠ delivery priority.** Importance = how core it is; priority = MoSCoW for
  release planning.
- Governance entity: capabilities **cannot** carry `code_refs` - express code grounding via a
  single `evidence: { kind: codebase-analysis, source: <path> }` and `discovery_stage`/`certainty`.

## `value-stream.yaml`
```yaml
value_streams:
  - id: VS001
    name: "Browse-to-Delivery"
    trigger: "A shopper needs a product"
    outcome: "An order is delivered"
    stages:
      - { name: "Browse",   capabilities: [CAP001] }
      - { name: "Checkout", capabilities: [CAP003] }
      - { name: "Fulfil",   capabilities: [CAP004] }
    discovery_stage: validated
    certainty: probable
```
Stages are ordered phases; each is served by ≥1 capability. Optionally add `primary_actors`,
`metrics` (KPI refs), `lead_time`, `pain_points`.

## Method
1. List capabilities as **stable noun phrases**; resist naming them after teams, systems, or
   processes.
2. Group into a shallow hierarchy (L1 → children).
3. Rate `strategic_importance` and (for planning) `delivery_priority`.
4. Draw **value streams** as stage sequences over those capabilities; link goals/metrics.
5. (Phase 3) wire `operations`/`rules`/`concepts` that realize each capability.

## Brownfield notes
Capabilities are inferred groupings over real functionality - the functionality is evidence
(`codebase-analysis`), but the capability framing and importance are your judgement → keep
`certainty: probable` unless stakeholder-confirmed. Split a capability map by concern into several
`*.capability.yaml` files (e.g. `order-management.capability.yaml`).

## Anti-patterns
- Capabilities named after systems/teams/processes ("the message queue", "the admin screen").
- A capability map that is really an org chart or a process flow.
- Forcing `code_refs` onto capabilities (not allowed - use evidence).
