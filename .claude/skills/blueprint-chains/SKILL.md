---
name: blueprint-chains
description: The 21 cross-layer traceability chains and feedback loops a blueprint carries - each hop as a typed reference (From -field→ To), which are flagship, and the gap cue that tells you a chain has dead-ended. Use when wiring a new entity to its next hop, auditing a slice for broken traceability, or explaining what the model is actually for.
---

# Traceability Chains & Loops - reference (21 chains)

A blueprint's value is not its layers in isolation - it's the **cross-layer paths** that connect them,
each mirroring an SDLC subprocess (assess, decide, prioritize, evolve, verify, discover, measure). Each
chain already exists as **typed references between entities**; authoring well means keeping the chains
**intact**. When you add an entity and don't wire its next hop, the chain **dead-ends** - surfacing that
gap is half the value.

**How to read this doc.**
- **Kind:** `T` = linear trace (forward traceability) · `L` = feedback loop (closes back - the SDLC
  "engines"). `★` = flagship (highest value).
- **Path:** each hop is `From -field→ To`. Most hops are *forward* (the `From` entity owns the reference
  field). A hop marked *(reverse)* is read against ownership - the `To` entity owns the field, and you
  reach it by reading backward (e.g. a `decision` owns `motivation_refs`, so `goal ← decision` is
  reverse).
- **Gap cue:** a *missing* next hop is only a real problem once the source node is mature enough to have
  it. Phase-1 skeletons legitimately leave later hops open - record the deferral instead of pretending
  the chain is complete (convention, not enforcement).

**Tooling note.** No tool in the public repo "walks" a named chain for you. Treat this as **authoring
discipline**; the **semantic checker** (`npm run check`) catches the most common breaks (orphan
entities, commands with no `produces`, untested rules, unanswered questions). To inspect a chain by
hand, grep the reference fields, or build `model.json` with the schema repository's model builder
(`node "$SCHEMA_ROOT/tools/model-builder/dist/cli.js" "$MODEL_DIR" --output model.json`, after its
`npm run build`) and follow the typed relations.

---

## All 21 at a glance

| ID | Chain | Family | Kind | ★ | Subprocess |
|----|-------|--------|------|---|------------|
| CH01 | Rationale Spine | Reasoning & governance | T | ★ | motivate → decide → constrain |
| CH02 | Risk Governance Loop | Reasoning & governance | L | ★ | identify → decide → mitigate → re-assess |
| CH03 | Assumption Exposure | Reasoning & governance | T |  | assume → expose → threaten |
| CH04 | Discovery / Knowledge Loop | Reasoning & governance | L | ★ | ask → answer → verify |
| CH05 | Inquiry Resolution | Reasoning & governance | L |  | raise → investigate → resolve |
| CH06 | AS-IS Remediation Chain | Reasoning & governance | L | ★ | assess → decide → evolve → re-assess |
| CH07 | Leverage Map | Reasoning & governance | T | ★ | prioritize (vital few) |
| CH08 | Leverage-to-Delivery | Reasoning & governance | T |  | prioritize → schedule → ship |
| CH09 | Vertical Slice / Verification | Delivery & verification | L | ★ | specify → build → verify |
| CH10 | Use-Case Journey | Delivery & verification | T |  | scenario → story → step |
| CH11 | Process Flow | Delivery & verification | L |  | trigger → activity → causal |
| CH12 | UI Impact / CIA | Delivery & verification | T |  | domain change → UI impact |
| CH13 | Strategy-to-Execution | Strategy & value | T | ★ | intend → enable → flow → deliver |
| CH14 | Delivery Plan | Strategy & value | T |  | plan → sequence → ship |
| CH15 | Measurement Chain | Strategy & value | L | ★ | target → measure → react |
| CH16 | Causal Backbone | Structure & behavior | L | ★ | command → event → reaction |
| CH17 | Concept Web | Structure & behavior | T |  | ubiquitous language |
| CH18 | Architecture Decomposition | Structure & behavior | T |  | boundary → service → contract |
| CH19 | Accountability / Ownership | Structure & behavior | T |  | own → escalate |
| CH20 | Evolution Chain | Structure & behavior | T |  | decide → migrate → depend |
| CH21 | Bounded-Context Governance | Structure & behavior | T |  | policy → context |

---

## Family A - Reasoning & governance (the decision spines + loops; highest value)

### CH01 - Rationale Spine ★ · T
**Why → what we decided → what enforces it.** A decision names the goals/risks that motivate it and the
concrete rules/operations/concepts/models/screens it changes.
- Path: `goal`/`risk` ← `decision` (via `motivation_refs`, reverse) -`declared_impact`→ `rule`/`operation`/`concept`/`model`/`story`/screen
- Gap cue: an **accepted/confirmed decision with no `declared_impact`** - its rationale points nowhere.
- Example: G002 "Prevent overselling" ← D014 "single-writer stock ledger" → VR021 "reject order if reserved > on-hand".

### CH02 - Risk Governance Loop ★ · L
**Goal → threatening risk → mitigating decision → mitigation → re-assess.**
- Path: `goal` ← `risk` (via `risk_goal`, reverse) ← `decision` (via `motivation_refs`, reverse) -`declared_impact`→ `rule`; loop closes on `risk.review_date`.
- Gap cue: an **open, high/medium-probability risk with no mitigating decision**.
- Example: R004 "checkout latency SLO breach" threatens G001 ← D021 "read-model projection" → VR030; re-assess at review date.

### CH03 - Assumption Exposure · T
**A belief carries a risk that threatens a goal.**
- Path: `assumption` -`assumption_risk`→ `risk` -`risk_goal`→ `goal`
- Example: A012 "PSP sandbox parity with prod" → R009 "go-live payment failures" → G003 "reliable payments".

### CH04 - Discovery / Knowledge Loop ★ · L
**A question is answered by an operation and verified by a test; unanswered = gap.**
- Path: `question` -`answered_by`→ `operation`; -`motivated_by`→ `goal`; -`about`→ `concept`; `operation` ← `test` (via `validates`, reverse). Answering a question tends to surface new ones.
- Gap cue: a **blocking, unresolved question with no `answered_by`**.
- Example: QN007 "cancel after ship?" → CMD031 "Request Return" ← TC088 "return within 24h".

### CH05 - Inquiry Resolution · L
**A governance inquiry references the goals/risks/questions it must resolve.**
- Path: `inquiry` -`inquiry_goal`/`inquiry_risk`/`inquiry_question`/`inquiry_finding`→ targets; `inquiry_owner`→ `actor` or `team`. Resolving one may raise follow-ons.
- Example: INQ003 "build vs buy fraud check" → R011, G004, QN012.

### CH06 - AS-IS Remediation Chain ★ · L
**A finding rolls into a risk, addressed by a decision, remediated by a migration; then re-assess.** The
AS-IS improvement engine.
- Path: `finding` -`risk_refs`→ `risk` -`decision_refs`/`motivation_refs`→ `decision` -`migration`→ `migration` → re-assess. (`finding.risk_refs`/`decision_refs`/`migration` are direct shortcuts over the same path.)
- Gap cue: a **validated / planned / in-progress finding with no `risk_refs`, `decision_refs`, or `migration`** - it's inert.
- Example: FN012 "N+1 query on order list" → R004 → D021 → MIG033 → re-scan → FN019.

### CH07 - Leverage Map ★ · T
**A leverage point bundles findings/risks/decisions and delegates delivery to work-items** - the "vital
few" tier above CH06. It *references*, never duplicates.
- Path: `leverage_point` -`leverage_finding`/`leverage_risk`/`leverage_decision`/`leverage_migration`→ targets; -`leverage_realized_by`→ `work_item`; -`leverage_advances_goal`→ `goal`; -`leverage_depends_on`→ `leverage_point`.
- Gap cue: an **accepted / in-progress leverage point with no `realized_by` work-item**.
- Example: LP002 "make schema evolution safe" → {FN012, R004, D021} → WI014 → G001.

### CH08 - Leverage-to-Delivery · T
**Prioritized intervention → scheduled work-item → release milestone → deliverable.**
- Path: `leverage_point` -`leverage_realized_by`→ `work_item` -`work_item_milestone`→ `milestone` -`milestone_deliverable`→ `capability`.
- Example: LP002 → WI014 → MS003 "H2 release" → CAP021.

---

## Family B - Delivery & verification

### CH09 - Vertical Slice / Verification ★ · L
**User story → operations that realize it → tests that prove it; a failing test becomes a finding (→ CH06).**
- Path: `user_story` -`user_story_operation`→ `operation`; -`user_story_test_case`→ `test` -`validates`→ `rule`/`concept`/`model`.
- Gap cue: a **non-draft user story with no operation**; a **must-have story with no test**.
- Example: US001 "place an order" → CMD001 "Submit Order" + TC001; TC001 validates VR003.

### CH10 - Use-Case Journey · T
**A use case decomposes into user stories, operations, screens, and a primary actor.**
- Path: `use_case` -`use_case_user_story`/`use_case_operation`/`use_case_screen`/`use_case_actor`→ targets.
- Example: UC002 "Checkout Experience" → US001, CMD003, SCR002, ACT001.

### CH11 - Process Flow · L
**A story orders operations; operations chain by `produces`/`reacts_to` into the process** (the
authoritative flow is the domain causal chain - see CH16).
- Path: `story` -`story_orders_operation`→ `operation` -`produces`→ `event` ← `command` (via `reacts_to`, reverse).
- Example: STR001 → CMD001 → EVT001 "Order Submitted" ← CMD002 "Validate Payment".

### CH12 - UI Impact / CIA · T
**Screens/actions cross-link to models, goals, decisions, tests, stories, and operations** - the basis
for change-impact analysis (a domain change → the UI it touches).
- Path: `screen` -`screen_uses_model`/`screen_motivated_by`/`screen_decision`/`screen_validated_by`→ targets; `action` -`action_on_screen`→ `screen`; `action` -`action_triggers_operation`→ `operation`.
- Example: SCR002 "Payment" uses PaymentPayload, motivated_by G001, triggers CMD003 via UAC004.

---

## Family C - Strategy & value

### CH13 - Strategy-to-Execution ★ · T
**Value stream → goals it serves + capabilities it needs → operations that realize them.** How value
flows end-to-end: intent → ability → behavior.
- Path: `value_stream` -`value_stream_goal`→ `goal`; -`value_stream_capability`→ `capability` -`capability.operations`→ `operation`; `capability` -`capability_goal`→ `goal`.
- Example: VS001 "Shop & Buy" → G001 + CAP003 "Checkout" → CMD001..CMD003.

### CH14 - Delivery Plan · T
**Milestones/work-items carry typed traceability to goals/decisions, plus a WBS + dependencies.**
- Path: `milestone` -`roadmap_advances_goal`/`roadmap_realizes_decision`/`milestone_deliverable`→ targets; `work_item` -`work_item_child`/`work_item_dependency`→ `work_item`; `milestone` -`milestone_dependency`→ `milestone`.
- Gap cue: a **milestone with a target date but no `advances_goal`**.
- Example: MS001 "MVP" advances G001, realizes D001, delivers CAP001; WI001 → WI002 (child).

### CH15 - Measurement Chain ★ · L
**Goal → KPI → metric → operation/concept → SLO → SLA; a breach opens a risk (→ CH02).**
- Path: `goal` -`kpi`→ `KPI` -`metric`→ `metric` -`slo.operations`→ `operation`/`concept` → `SLO` → `SLA`.
- Gap cue: a **critical-priority goal with no KPI** - it's unmeasured.
- Example: G001 "fast checkout" → KPI001 "p95 checkout time" → MT004 → CMD003 → SLO002 → SLA001.

---

## Family D - Structure & behavior

### CH16 - Causal Backbone ★ · L
**Command produces event; command reacts_to event; operation materializes concept** - the behavioral
spine of the domain.
- Path: `command` -`produces`→ `event` ← `command` (via `reacts_to`, reverse); `operation` -`materializes`→ `concept`. Reactions form sagas / cycles across contexts.
- Gap cue: a **command with no `produces` event** breaks the backbone.
- Example: CMD001 → EVT001 ← CMD002 → EVT002; CMD001 materializes CN001 "Order" (create).

### CH17 - Concept Web · T
**Concepts relate/associate; transition rules move concept state; rules constrain concepts** - the
ubiquitous-language web.
- Path: `concept` -`relationship`/`association`→ `concept`; `concept` -`transition_rules`→ `rule`; `rule` -`concepts`→ `concept`.
- Example: CN001 "Order" -contains→ CN002 "OrderLine"; OrderStatus transition rule TR003.

### CH18 - Architecture Decomposition · T
**Context contains services; service provides contracts; service deploys to a tier.**
- Path: `context` -`contains`→ `service` -`provides`→ `contract`; `service` -`deployed_in_tier`→ `tier`.
- Example: Checkout context → OrderService → OrdersAPI contract; deployed in app-tier.

### CH19 - Accountability / Ownership · T
**Any entity → owning team → department → party.**
- Path: `entity` -`owned_by`→ `team`; `department` -`dept_has_team`→ `team`; `party` -`org_contains_dept`→ `department`.
- Example: CN001 owned_by TM001 "Checkout Team" ← DPT002 "Commerce" ← PRT001 "Acme".

### CH20 - Evolution Chain · T
**Migrations realize decisions, depend on prior migrations, and remediate findings** - the AS-IS → TO-BE
structural fix behind findings/leverage.
- Path: `migration` -`related_decisions`→ `decision`; `migration` -`depends_on`→ `migration`; `finding` -`migration`→ `migration`; `leverage_point` -`leverage_migration`→ `migration`.
- Gap cue: a **non-draft migration with no related decision**.
- Example: MIG033 realizes D021, depends_on MIG030; FN012.migration = MIG033.

### CH21 - Bounded-Context Governance · T
**Business decisions and assumptions bind to the bounded contexts they govern.**
- Path: `business_decision` -`domain_scope`→ `context`; -`linked_contexts`→ `context`; -`linked_user_stories`→ `user_story`; `assumption` -`domain_scope`→ `context`; `kpi` -`domain_scope`→ `context`.
- Note: `domain_scope` is a kebab-case scope slug naming a region of the problem space, matched by name. A typed `BC###` reference is `bounded_context_ref`, which an arch context, an inter-context dependency and a competency question carry; **op→BC membership is contract-derived, not a domain ref** (see the modeler's arch-identity section).
- Example: BD005 "EU-only fraud policy" → Checkout context + US012.

---

## The feedback loops are the engines

Teach and preserve the cross-family loops - they're where the SDLC actually turns:

- **`test-fail → finding`** (CH09 → CH06) - a failing verification becomes an AS-IS finding.
- **`KPI-breach → risk`** (CH15 → CH02) - a missed target opens a risk.
- **re-assessment → new finding** (CH06 self-loop) - remediation surfaces the next issue.
- **answer → new question** (CH04 self-loop) - discovery is never "done".

## The one habit

**Wire the next hop as you author.** A finding with no risk/decision/migration is inert (CH06); a
critical goal with no KPI is unmeasured (CH15); a decision with no motivation is unjustified (CH01); a
command with no `produces` breaks the causal backbone (CH16). Catch these while modeling - not in review.
