---
name: cognitive-tools
description: Thinking archetypes and cognitive tools. Use for risk analysis, problem decomposition, or when Inversion, Separation of Concerns, or Constraint-First Thinking are relevant.
---

# Thinking Archetypes & Cognitive Tools

Answer: *How should I think about this problem?*

Use this skill for architecture reviews, requirements review, and disciplined decomposition.

---

## Methods

### Inversion (Charlie Munger)
Instead of "how do I make this work?" ask "what would guarantee failure?" Avoid those things.

**When:** Risk analysis, requirements review, architecture review.

### Separation of Concerns as Thinking Discipline (Dijkstra)
Beyond code: separate what changes together from what changes independently; who needs to know from who doesn't; when from what. Most modeling failures are separation failures.

**When:** Decomposition; avoiding models correct in one dimension, wrong in another.

### Constraint-First Thinking
Begin with *constraints* - what is NOT allowed, what must always be true, what is limited, what is immutable. Constraints are more stable than features.

**When:** Regulatory domains, safety-critical systems; when "what you can't do" matters more than "what you can do."

---

## Blueprint Integration

- **motivation.yaml** - Risks (inversion); non-goals (constraint-first)
- **rules.yaml** - Invariants, prohibited states (constraint-first); clear separation of rule categories
- **decisions.yaml** - Rationale; negative requirements surfaced by inversion
