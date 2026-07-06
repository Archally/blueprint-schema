# Leverage Handoff Guide

Use this guide when you need to describe **the few interventions that would move the system forward the most**.

This guide is about choosing the **vital few priorities** — not listing every problem, and not scheduling every task.

## Knowledge area

This guide helps with **the most important cross-cutting priorities**. Technically, it covers **leverage points, Pareto-core intervention choices, and consequence-based prioritization**.

## Main entities in this guide

- `leverage_point` — a prioritized intervention that would improve the system more than nearby
  alternatives.
- `pareto_core` — the small committed subset of leverage points chosen as the vital few.
- `watch_item` — something important enough to monitor but not yet promoted into a full leverage
  point.
  - Often confused with: a `finding` or a roadmap `work_item`. A leverage point names the
    intervention; a finding names the problem; a work item names delivery work.

## What belongs here

- leverage points or top interventions
- ranking basis or prioritization rubric
- the vital few selected now (`pareto_core`)
- what findings, risks, decisions, and fitness functions each leverage point addresses
- what roadmap work items or migrations will realize it
- what goals, value streams, or capabilities it advances
- what depends on what between leverage points
- consequence framing: what improves if acted on, what persists if ignored
- watchlist items not yet promoted into full leverage points

## What does not belong here

- raw lists of every defect or finding
- detailed milestone scheduling
- full ADR text duplicated from decisions
- low-level implementation task breakdown

## Core things to capture

- the intervention title and the single "one thing" it achieves
- why it is high leverage now
- rank, area, and status
- what existing findings, risks, or decisions it bundles
- what delivery work or migrations will make it real
- what goals, value streams, or capabilities it advances
- what other leverage points it depends on or unlocks
- what happens if it is done — and if it is not done
- what is only being watched for now

## Core relationships to capture

- leverage point -> finding/risk/decision addressed
- leverage point -> migration or roadmap work item that realizes it
- leverage point -> goal/value stream/capability advanced
- leverage point -> leverage point dependency or enablement
- watchlist item -> finding/risk/decision being monitored

## Modus operandi

Use leverage capture to compress many signals into a small number of meaningful priorities:

1. review the strongest findings, risks, and decision pressure first
2. group them into a few interventions that would change the situation materially
3. name the single "one thing" each intervention achieves
4. rank them using an explicit rubric
5. separate the vital few from the watchlist
6. delegate delivery details to roadmap work items instead of duplicating a schedule here
7. write down both the expected gain and the cost of inaction

## Prompt set

- what is the one intervention that would change the situation the most?
- what findings or risks make this necessary?
- what decision logic or guardrail does it depend on?
- what work will actually deliver it?
- what other priorities must land first?
- what does it unlock once done?
- what would continue to hurt if we do nothing?
- what is worth watching but not yet committing to?

## Free-text intake template

- **Leverage point title:**
- **One thing it achieves:**
- **Why now:**
- **Rank / priority band:**
- **Area:**
- **Status:**
- **Addresses findings / risks / decisions / fitness functions:**
- **Realized by roadmap work items / migrations:**
- **Advances goals / value streams / capabilities:**
- **Depends on / enables:**
- **Consequences if done:**
- **Consequences if not done:**
- **Watchlist items:**

## Worked example

- **Leverage point:** consistent return decisions across storefront and support channels
- **One thing it achieves:** one eligibility policy decides whether a return is accepted, regardless of channel
- **Why now:** duplicate decision logic causes customer confusion, refund rework, and support escalation
- **Rank:** 1
- **Area:** post-purchase control
- **Status:** accepted
- **Addresses:** duplicated return-eligibility findings, refund inconsistency risk, auto-approval decision policy
- **Realized by:** roadmap work items for eligibility engine rollout and support review console integration
- **Advances:** customer self-service returns goal, product return fulfillment value stream, returns management capability
- **Depends on / enables:** depends on refund event-model alignment; enables faster refund-status automation
- **Consequences if done:** fewer contradictory decisions, lower support effort, clearer customer outcomes
- **Consequences if not done:** channel drift persists, refund exceptions keep growing, trust in self-service stays weak
- **Watchlist item:** cross-border return exceptions remain monitored until fraud policy stabilizes

## Layer-specific handoff guidance

For leverage, the handoff should make **priority and consequence** obvious.

The receiver should clearly see:

- why this priority matters more than nearby alternatives
- what evidence or pressure makes it urgent
- what delivery work will realize it
- what future watch items are not yet committed

If leverage notes read like a schedule, they belong in roadmap. If they read like a defect dump, they belong in findings.

## How this becomes YAML

A technical modeler or AI agent can transform this into leverage points, Pareto-core selections, watchlist items, typed cross-links to findings/risks/decisions/goals/value streams/capabilities, and references to the roadmap work items or migrations that realize the intervention.

## Common mistakes

- listing too many priorities to be truly selective
- repeating roadmap detail instead of naming the intervention
- missing the cost of inaction
- not saying what findings, risks, or decisions made the priority necessary
- mixing active leverage points with "maybe later" watchlist items