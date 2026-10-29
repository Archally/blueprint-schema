---
name: formalization-and-modeling
description: Formalization and modeling languages for expressing domain models precisely. Use when building concepts, rules, or operations; defining ubiquitous language; writing formal specs; or when DDD, SBVR, formal methods, BDD, CQRS, event sourcing, state machines, or type-driven modeling are relevant.
---

# Formalization & Modeling Languages

Answer: *How do we express the domain model precisely and unambiguously?*

Use this skill when defining concepts, rules, and operations; establishing ubiquitous language; or translating discovery into formal blueprint artifacts. **Core to the original 5 methods:** DDD, SBVR, Formal Methods.

---

## Methods (Original 5)

### DDD & Ubiquitous Language (Eric Evans)
Strategic + tactical domain modeling. Shared vocabulary across stakeholders and code. Bounded contexts, aggregates, entities, value objects, domain events.

**When:** Any domain modeling; backbone of blueprint concepts.yaml and rules.yaml.

**Best sources:**
- Eric Evans, "Domain-Driven Design: Tackling Complexity in the Heart of Software"
- https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf - DDD Reference
- https://martinfowler.com/bliki/UbiquitousLanguage.html - Ubiquitous Language

### SBVR (Semantics of Business Vocabulary and Business Rules)
OMG specification for formal business vocabulary. Concepts, definitions, rules in structured English. Predicate logic with modal operators (necessary, obligatory, prohibited, permitted).

**When:** Regulated industries; shared vocabularies across orgs; blueprint rules modality.

**Best sources:**
- https://www.omg.org/spec/SBVR/1.5/PDF - OMG SBVR 1.5
- https://www.brcommunity.com/ - Business Rules Community articles

### Formal Methods (Z, Alloy, TLA+, VDM)
Mathematical correctness. Z for state-based specs; Alloy for relational modeling; TLA+ for distributed/concurrent systems; VDM for industrial formal development.

**When:** Safety-critical; proving invariants; concurrent/distributed system design.

**Best sources:**
- Alloy: https://alloytools.org/
- TLA+: https://lamport.azurewebsites.net/tla/tla.html
- Leslie Lamport, "Specifying Systems" (TLA+)

---

## Methods (Extended)

### Ontology Engineering (OWL, RDFS, OntoUML, IDEF5)
Formal conceptualizations: classes, properties, relationships, axioms. Automated reasoning, consistency, interoperability.

**When:** Regulated industries, data integration, enterprise vocabularies.

### BDD / Specification by Example
Given-When-Then (Gherkin). Living documentation - spec is executable test.

**When:** Complex business rules; combines with Example Mapping.

**Best sources:** https://cucumber.io/docs/bdd/

### CQRS + Event Sourcing (Greg Young)
Separate read/write; state as event sequence. Events as first-class concepts. Audit trail, temporal queries.

**When:** Complex workflows, compliance, auditability. NOT for simple CRUD.

### State Machines & Statecharts (David Harel)
States, transitions, guards, actions. Hierarchy, concurrency, history. Makes invalid transitions unrepresentable.

**When:** Order lifecycles, approval workflows, device control.

**Best sources:** Harel statecharts - UML state machines, SCXML

### Algebraic / Type-Driven Modeling (Scott Wlaschin)
Sum/product/phantom types. Make illegal states unrepresentable at compile time.

**When:** FP contexts (F#, Haskell, Rust, Scala, TS discriminated unions).

**Best sources:** Scott Wlaschin, "Domain Modeling Made Functional"

---

## Blueprint Integration

- **concepts.yaml** - Ubiquitous language, actors, enumerations, associations, lifecycle states
- **rules.yaml** - SBVR modality (necessary, obligatory, prohibited, permitted); structural, classification, derivation, equivalence, validation, transition
- **domain.yaml** - Operations with preconditions/postconditions, responses
- **models.yaml** - Data shapes when needed
