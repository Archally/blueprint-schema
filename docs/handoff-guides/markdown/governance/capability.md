# Capability Handoff Guide

Use this guide when you need to describe **what the business can do**, independent of team names,
systems, or specific process steps.

This guide is about stable business abilities — the **what**, not the **how**.

## Knowledge area

This guide helps with **what the business needs to be able to do**. Technically, it covers
**stable business abilities and operating model scope**.

## What belongs here

- business capabilities
- capability hierarchy or decomposition
- links to important goals, concepts, rules, and operations

## What does not belong here

- detailed workflows
- organization charts
- implementation-specific system descriptions

## Core things to capture

- the capability name
- what business ability it represents
- how it decomposes into smaller abilities
- what goals it supports
- what concepts, rules, or operations it depends on

## Core relationships to capture

- parent capability -> child capability
- capability -> goal supported
- capability -> concept/rule/operation involved

## Modus operandi

Start with stable business language:

1. ask what the business must be able to do
2. separate that from teams, tools, and workflows
3. decompose broad capabilities into clearer child capabilities
4. link them to business goals and important domain elements

## Prompt set

- what business ability are we describing?
- is this stable over time?
- can it be decomposed into smaller abilities?
- what goals does it support?
- what concepts or rules are central to it?

## Free-text intake template

- **Capability name:**
- **Meaning:**
- **Parent capability (if any):**
- **Child capabilities:**
- **Supported goals:**
- **Related concepts/rules/operations:**

## Worked example

- Returns Management is a top-level capability
- It decomposes into Request Return, Review Return, and Track Refund Status
- It supports customer self-service and post-purchase operations goals

## Layer-specific handoff guidance

For capabilities, the handoff should preserve the **stable business ability** rather than the
current implementation.

The receiver should clearly see:

- what the business must be able to do
- how broad capabilities decompose into smaller ones
- what goals or concepts they support

If the description sounds like a workflow or a team backlog item, the capability handoff is too
implementation-shaped.

## How this becomes YAML

A technical modeler or AI agent can transform this into capability entries and hierarchy links with
traceability to goals, concepts, rules, and operations.

## Common mistakes

- describing a process instead of a capability
- making capability names tool- or team-specific
- skipping hierarchy when the capability is too broad