---
name: first-principles-thinking
description: Reframe a domain, subject, or task from first principles before answering, planning, or implementing. Use for unfamiliar problems, ambiguous requests, architectural choices, domain modeling, or non-trivial code changes where assumptions should be derived instead of copied from surface patterns.
---

# First-Principles Thinking

Answer: *What is fundamentally true here, and what follows from that?*

Use this skill before solving the problem, not after committing to a solution.

## When to use

- The user asks a deep question about a domain, system, or trade-off.
- The task is ambiguous, novel, or easy to solve with cargo-cult patterns.
- A code or modeling change could be high-impact, expensive, or hard to undo.
- A proposed solution seems driven by tools, frameworks, or convention rather than fundamentals.

## When not to use

- The task is trivial, mechanical, or already fully specified.
- The user wants a direct rote transformation with no meaningful design choice.
- The cost of deep analysis would outweigh the value of the answer.

## Inputs needed

- Desired outcome
- Known facts and evidence
- Constraints and invariants
- Unknowns or assumptions
- Important trade-offs

## Procedure

1. Define the real problem in one or two sentences.
2. Separate four buckets explicitly:
   - facts
   - constraints
   - assumptions
   - unknowns
3. Identify the domain primitives:
   - core actors
   - objects or resources
   - state changes
   - flows, dependencies, or causal links
4. Ask what must be true regardless of framework, tool, or implementation style.
5. Rebuild the solution from those primitives upward.
6. Check whether the proposed answer is:
   - necessary
   - sufficient
   - overcomplicated
   - dependent on weak assumptions
7. Stress-test with failure modes, edge cases, and reversibility.
8. Only then present the recommendation, explanation, or implementation plan.

## Heuristics

- Prefer invariants over preferences.
- Prefer causal structure over surface similarity.
- Prefer constraints over feature lists.
- Prefer removing assumptions before adding complexity.
- If two solutions seem equal, prefer the one with fewer hidden dependencies.

## Output contract

Use this shape internally, then compress it for the user:

```markdown
Problem:
Facts:
Constraints:
Assumptions:
Unknowns:
First principles:
Options considered:
Recommended path:
Why this follows:
Key risks:
```

## Quality checks

- The answer names at least one invariant or non-negotiable constraint.
- The recommendation is justified from fundamentals, not only precedent.
- Hidden assumptions were surfaced or clearly labeled.
- The final answer is still concise and useful to the user.

## Pairing

- Use `cognitive-tools` when inversion, constraint-first thinking, or separation of concerns needs extra emphasis.
- Use domain-specific skills after this one establishes the right frame.

## Safety

- Do not use first-principles language as decoration; show actual decomposition.
- Do not let analysis become paralysis. Once the fundamentals are clear, move forward.
- If crucial facts are missing, ask only the smallest set of questions needed to resolve the decision.
