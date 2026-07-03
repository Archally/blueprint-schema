# Value Stream Handoff Guide

Use this guide when you need to describe an **end-to-end flow of value** that crosses capabilities,
teams, or bounded contexts.

This guide is about **how value is delivered from trigger to outcome**.

## Knowledge area

This guide helps with **how value flows from trigger to outcome**. Technically, it covers
**end-to-end value delivery flow**.

## What belongs here

- end-to-end value streams
- triggers and outcomes
- ordered stages of value creation
- primary actors
- related capabilities and end-to-end measures

## What does not belong here

- a low-level step-by-step process inside one team only
- a capability map with no flow
- isolated milestones with no value journey

## Core things to capture

- what value stream exists
- what triggers it
- what outcome it delivers
- what stages it passes through
- who benefits or participates
- what capabilities support each stage

## Core relationships to capture

- value stream -> stage
- stage -> capability
- stream -> primary actor
- stream -> trigger and outcome
- stream -> end-to-end measure or goal

## Modus operandi

Describe value from outside-in:

1. identify the trigger
2. identify the final value delivered
3. split the journey into stages
4. identify actors and capabilities involved
5. note end-to-end success measures

## Prompt set

- what starts the value stream?
- what final value is delivered, and to whom?
- what stages happen in between?
- what capabilities enable each stage?
- what end-to-end measures matter?

## Free-text intake template

- **Value stream name:**
- **Trigger:**
- **Outcome/value delivered:**
- **Primary actors:**
- **Stages:**
  - stage:
  - purpose:
  - supported capabilities:
- **Measures/goals:**

## Worked example

- Value stream: employee leave fulfillment
- Trigger: employee needs time off
- Outcome: approved leave is recorded and communicated
- Stages: request, review, decision, notification, calendar update

## Layer-specific handoff guidance

For value streams, the handoff should preserve the **end-to-end value journey**.

The receiver should be able to tell:

- what triggers the stream
- what final value is delivered
- what stages happen in between
- what actors and capabilities support the journey

If the description has stages but no trigger or final outcome, the handoff is missing its frame.

## How this becomes YAML

A technical modeler or AI agent can transform this into value stream entries with ordered stages,
actors, capability links, and outcome framing.

## Common mistakes

- confusing a capability with a value stream
- skipping the trigger or final outcome
- making stages too technical
- omitting the capabilities that support the stream