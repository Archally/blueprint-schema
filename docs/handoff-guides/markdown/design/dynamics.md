# Dynamics Handoff Guide

Use this guide when you need to describe **runtime timing, concurrency, ordering, and execution
hazards**.

This guide is about **how work runs in time**, not what the business process means.

## Knowledge area

This guide helps with **timing, sequencing, and coordination**. Technically, it covers **runtime
behavior and temporal coordination**.

## What belongs here

- ordering constraints
- parallel work opportunities
- race conditions or timing hazards
- execution model assumptions
- important resource pressure notes

## What does not belong here

- the business narrative of a story
- infrastructure inventory
- static architecture boundaries

## Core things to capture

- what must happen before what
- what can happen at the same time
- what must never overlap unsafely
- what execution style is assumed
- where timing or load matters

## Core relationships to capture

- operation A -> must happen before operation B
- operations X and Y -> can run in parallel
- concurrent actions -> risk or collision
- runtime behavior -> resource pressure or delay

## Modus operandi

Start from real runtime concerns:

1. identify operations that can overlap
2. identify operations that must stay ordered
3. describe known race conditions or timing hazards
4. record why concurrency matters or is dangerous
5. record important resource constraints

## Prompt set

- what must happen first?
- what can run in parallel?
- what can go wrong if timing overlaps?
- what delays or bottlenecks matter?
- what execution style best describes the runtime behavior?

## Free-text intake template

- **Runtime concern name:**
- **What is happening:**
- **Ordering requirement:**
- **Parallel opportunity:**
- **Risk or hazard:**
- **Expected benefit or impact:**
- **Resource notes:**

## Worked example

- Approval check and calendar sync can run in parallel after a leave request is submitted
- Balance update must happen before final approval notification
- Two managers acting on the same request can cause a race condition if state is stale

## Layer-specific handoff guidance

For dynamics, the handoff should make **timing and concurrency** understandable without guesswork.

State explicitly:

- what must happen in order
- what may happen in parallel
- what collisions or timing hazards exist

If the receiver cannot tell why a race condition matters, describe the consequence more clearly.

## How this becomes YAML

A technical modeler or AI agent can transform this into ordering, parallelism, race-condition, and
execution-model entries tied to the relevant operations.

## Common mistakes

- describing business steps instead of runtime timing
- saying "this is parallel" without naming the operations
- omitting the consequence of a race condition
- confusing infrastructure deployment with execution behavior