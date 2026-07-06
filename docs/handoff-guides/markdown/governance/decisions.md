# Decisions Handoff Guide

Use this guide when you need to describe **important choices, why they were made, what options were
considered, and what impact they have**.

This guide is about explicit rationale, not hidden assumptions.

## Knowledge area

This guide helps with **important choices and why they were made**. Technically, it covers
**decision rationale and governance traceability**.

## Main entities in this guide

- `decision` — a recorded architecture or policy choice with status, rationale, and impact.
- `business_decision` — a business-governance choice whose consequences shape the model or
  delivery.
- `option` — an alternative that was considered before the final choice.
- `rationale` — the reasoning that explains why the chosen option won.
  - Often confused with: an `assumption` in Motivation. A decision is a committed choice; an
    assumption is something believed true but not yet proven.

## What belongs here

- architecture or policy decisions
- business decisions with lasting effect
- status of decisions (proposed, accepted, etc.)
- rationale, trade-offs, and impact

## What does not belong here

- raw brainstorming with no actual decision
- generic requirements with no choice or rationale
- goals or risks by themselves without a decision attached

## Core things to capture

- what was decided
- why it was decided
- what options were considered
- what impact areas are affected
- what motivation, risk, or trade-off shaped the choice

## Core relationships to capture

- decision -> affected area
- decision -> goal/risk/assumption/trade-off motivating it
- decision -> status or superseding decision

## Modus operandi

Document decisions when a real choice has been made:

1. state the decision clearly
2. explain the problem or context
3. record the main options considered
4. explain the rationale
5. state the impact and status

## Prompt set

- what choice was made?
- what problem or tension did it address?
- what options were on the table?
- why was this option chosen?
- what will it affect?

## Free-text intake template

- **Decision title:**
- **Context/problem:**
- **Options considered:**
- **Chosen option:**
- **Why:**
- **Impacted areas:**
- **Status/date:**
- **Related goals/risks/assumptions:**

## Worked example

- Decision: eligible return requests are auto-approved within policy thresholds
- Context: operations wants faster customer resolution and lower support volume
- Options: manual support review for every request vs policy-based auto-approval
- Chosen: policy-based auto-approval
- Impact: workflow, authorization, audit trail, support dashboard

## Layer-specific handoff guidance

For decisions, the handoff should preserve **choice and rationale together**.

The receiver should not have to guess:

- what was decided
- what alternatives were considered
- why this option won
- what areas are affected

If the rationale is missing, the handoff captures a conclusion but not a decision.

## How this becomes YAML

A technical modeler or AI agent can transform this into decisions or business decisions with
status, rationale, and typed impact references.

## Common mistakes

- recording the conclusion but not the reason
- forgetting rejected options
- omitting affected areas
- confusing an assumption with a decision