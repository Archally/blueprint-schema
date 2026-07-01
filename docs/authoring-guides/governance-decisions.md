# Decisions Authoring Guide

Use this guide when you need to describe **important choices, why they were made, what options were
considered, and what impact they have**.

This guide is about explicit rationale, not hidden assumptions.

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

- Decision: managers approve leave requests within their department
- Context: HR wants local accountability and faster response
- Options: centralized HR approval vs manager approval
- Chosen: manager approval
- Impact: workflow, authorization, audit trail, manager dashboard

## How this becomes YAML

A technical modeler or AI agent can transform this into decisions or business decisions with
status, rationale, and typed impact references.

## Common mistakes

- recording the conclusion but not the reason
- forgetting rejected options
- omitting affected areas
- confusing an assumption with a decision