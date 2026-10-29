---
name: ddd-modeling
description: >
  Use when applying Domain-Driven Design while authoring an Archally blueprint - finding bounded
  contexts and their relationships (context map), classifying concepts as aggregate-root / entity
  / value-object / domain-service / read-model, defining the ubiquitous language, and locating
  domain events. Maps to arch.yaml, concepts.yaml, and domain.yaml. Pairs with event-storming and
  event-modeling.
---

# Domain-Driven Design for Blueprints

DDD has two altitudes. **Strategic** = how the system is partitioned (bounded contexts +
relationships) → `arch.yaml`. **Tactical** = the building blocks inside a context (aggregates,
entities, value objects, domain services, events) → `concepts.yaml` + `domain.yaml`.

## Strategic (arch.yaml)

- **Bounded context** = a boundary within which a model and its ubiquitous language are
  consistent. One business slice may hold one or several contexts.
- **Context classification** (`kind`): `core` (competitive advantage - invest here), `support`
  (enables core), `generic` (commodity). Add `business_model_role` (revenue/engagement/
  compliance) and Wardley `evolution` where useful.
- **Relationships** (`dependency.relationship`): `customer-supplier`, `conformist`,
  `anticorruption-layer` (translate to protect your model), `open-host-service`,
  `published-language`, `shared-kernel`, `partnership`, `separate-ways`. Set `direction`
  (upstream provides / downstream consumes) and `language_boundary` + `translation` when crossing
  ubiquitous languages.

## Tactical (concepts.yaml) - `stereotype`

| Stereotype | Test |
|---|---|
| `aggregate-root` | Own identity + lifecycle; a consistency boundary; the entry point for commands; owns child entities. |
| `entity` | Has identity & lifecycle but lives *inside* an aggregate. |
| `value-object` | Defined by its attributes; immutable; no independent identity. |
| `domain-service` | Stateless domain behavior not owned by any one entity. |
| `read-model` | Query-only projection (CQRS); no write operations of its own. |
| `specification` | A reusable business predicate. |

### Aggregate-root vs child entity (decision tree)
1. Has its own typed identity in code? **No →** value-object.
2. Has independent commands / its own command directory? **Yes →** aggregate-root.
3. Created/deleted independently of a parent? **Yes →** aggregate-root.
4. Referenced from outside its parent context? **Yes →** aggregate-root.
5. Otherwise → child `entity`.

An aggregate-root is the entry point for commands: the command that creates or changes it names it
in `materializes`, and a rule it obeys goes in that command's `governed_by` (or `preconditions` /
`postconditions`). The semantic checker reports, as info, a root no command reaches
(`aggregate-root-signals`), and says whether it has `states` and an owned `contains` relationship.
Neither is required; a root no command reaches is modelled ahead of its commands, or is not a root.

## Ubiquitous language

Name concepts/operations/rules in **business language**, not code. `OrderHdrTbl` → concept
`Order`; the class path goes in `code_refs`. Capture `synonyms` and put the formal DDD `term`/
`definition` in `properties` when they differ from `name`/`description`.

## Brownfield N:M mapping (this codebase is old - its boundaries may be wrong)

- **One concept, many files:** an aggregate spread over partial classes, mappers, and services is
  still **one** `aggregate-root` with multiple `code_refs`.
- **One file, many concepts:** a god class mixing two aggregates becomes **multiple** concepts,
  each `code_refs` → the same file.
- **Re-draw boundaries** the code got wrong (split an over-broad aggregate, merge a fragmented
  one). Record the judgement with `provenance` (lower `certainty`, an `assumption` evidence note)
  and a `QN###` when unsure; ask the user when it matters.

## Anti-patterns
- Mirroring database tables/classes 1:1 as concepts (model the *domain*, not the schema).
- Aggregate-root that no command reaches - none names it in `materializes`, none is governed by a
  rule about it (probably an entity, a naming artifact, or a model missing its commands).
- Anemic model: all data in concepts, all behavior missing from `domain.yaml` operations.
- Modeling a CRUD god-controller as one "Manage X" operation - split into real commands/queries.
