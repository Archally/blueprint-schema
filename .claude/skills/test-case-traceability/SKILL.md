---
name: test-case-traceability
description: >
  Use when linking a blueprint slice's test-cases to the real automated tests that verify them -
  attaching code_refs (role: test) and provenance/evidence to TC entities without letting the
  codebase dictate what is worth testing. Enforces the problem-model-first stance and the
  domain-level vs application-level test axis. Maps to test-cases.yaml (TC/FF), code_refs, and
  v2.7.4 test_case.provenance.evidence. Pairs with blueprint-modeling and sbvr-business-rules.
---

# Test-case ↔ code traceability

Make each test-case reflect **real verification** without letting the codebase dictate what is worth
testing. The blueprint is a **problem model first**: every test-case exists because it verifies
something meaningful in the problem space (a concept, rule, process, outcome, NFR, or finding) -
**never merely because a test exists in code**.

## Principle - problem-first, in both directions

- **Two discovery directions, one justification.** Discover **top-down** (domain → case → find a real
  test to link) OR by **bottom-up promotion** (a codebase test → a case ONLY if it has a stated
  problem rationale). Justify **problem-first** either way.
- **Domain-level vs application-level.** *Domain-level* cases validate a concept/rule/process/outcome a
  non-technical domain expert cares about (e.g. "an out-of-stock item is rejected at checkout").
  *Application-level* cases guard technical mechanics (DTO mapping, serialization, DI wiring,
  null-handling). **Lead with domain-level.**

## Procedure (per slice)

1. **Read the slice's domain knowledge** - its operations, rules, risks/inquiries, findings, and the
   relevant NFRs. List the domain-meaningful behaviors that SHOULD be verified - including ones
   implied by risks/NFRs/findings the current cases miss.
2. **Confirm/enrich the case set** from that list (add cases for uncovered NFR/finding-implied
   behaviors; mark TO-BE ones). Keep IDs stable; split long files by subdomain.
3. **Targeted code harvest** (thorough search, or surgical greps for the judgement calls): for EACH
   case, find a real automated test that genuinely exercises it. Classify each hit **domain-level vs
   application-level**; state NONE explicitly. Do NOT reverse-map the whole suite into cases.
4. **Attach `code_refs`** (`role: test`, repository-URI form `repo#path/to/Test.ext`; name the test
   method in the description) to cases with a real test. Match bar: the test must genuinely exercise
   the linked behavior, not merely touch the aggregate. A skipped/disabled test = **"automated but
   disabled"** - a distinct state; note it, don't count it as covered.
5. **Record non-code verification as evidence.** Manual/gap/TO-BE verification and provenance live on
   the test-case's **`provenance.evidence`** (v2.7.4 added `provenance` to `test_case` + `fitness_function`):
   `kind` ∈ documentation / assumption / stakeholder-signoff / workshop (the values the schema admits;
   a manual test is `documentation` of the run, or `stakeholder-signoff` when a person attests it),
   with `source` + `certainty`.
   `code_refs` record **automation** (code evidence); `provenance.evidence` records everything else.
   **Never duplicate a `code_ref` as evidence** - they are orthogonal.
6. **Correct findings you disprove** before anchoring cases to them (see the call-chain rule below).
7. **Verify** against the schema + append a decision-log entry.

## Three verification states, and the code/evidence split
`automated` (a real, enabled test → `code_refs role:test`) · `manual` / `gap` / `TO-BE` (→
`provenance.evidence`). Code evidence and non-code evidence are orthogonal: automation in `code_refs`,
everything else in `provenance.evidence`.

## The call-chain rule (don't repeat this failure)
A brownfield finding about what an operation *leaves behind* (or fails to do) must follow the **whole
call graph**, not the entry method. The real behavior often lives one or two calls deeper - a top-level
`DeleteAsync` can look like a bare soft-delete while the field-level anonymization actually happens in a
**shared helper invoked downstream**. Grepping only the entry method yields a confident-but-**wrong**
conclusion. Before writing such a finding: **trace to the leaf**, corroborate with the integration
tests' assertions, and **prefer refuting your own claim**. Cost of skipping: a "confirmed" finding gets
overturned and must be rewritten, its risk re-scoped, its inquiry reframed. *(Captured as a learned-rule.)*

## Anti-patterns
- Reverse-mapping the whole test suite into cases (the code dictating the model - backwards).
- Counting a skipped/disabled test as coverage.
- Duplicating a `code_ref` as `provenance.evidence`.
- Application-level-only cases with no domain-level case behind them.
- Asserting a "no X happens" finding from the entry method without tracing the call chain.
