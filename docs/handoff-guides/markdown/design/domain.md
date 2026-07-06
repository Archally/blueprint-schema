# Domain Handoff Guide

Use this guide when you need to describe **operations that change, reveal, or communicate business
state**.

This guide is about **commands, events, queries, documents, errors, and key domain questions**.

## Knowledge area

This guide helps with **business actions and changes**. Technically, it covers **business behavior
and state-change logic**.

## Main entities in this guide

- `operation` — a named business action or notable response, such as a command, event, query, or
  document.
- `error` — a named failure outcome the domain needs to surface clearly.
- `question` — a named business question the system should be able to answer.
- `exchange` — the boundary shape an `operation` uses when it travels through an API, topic,
  queue, or similar channel.
  - Often confused with: a story step. An `operation` is a reusable domain action; a story step is
    one moment inside a larger journey.

## What belongs here

- business operations
- events that matter to the domain
- questions the domain must answer
- important errors or failure conditions
- causal links between operations

## What does not belong here

- the full narrative sequence of a journey
- the UI flow of screens and actions
- broad business goals or risks without operational relevance

## Core things to capture

- what operation happens
- whether it is a request, fact, read, or document exchange
- what it changes or reveals
- what can happen next
- what can go wrong
- what important question it answers

## Core relationships to capture

- command -> event/result
- query -> information returned
- operation -> concept affected
- operation -> rule/risk/quality concern
- question -> operation that answers it

## Modus operandi

Describe the domain as meaningful acts:

1. name the important business operations
2. separate requests from facts and reads
3. describe what each operation causes or answers
4. capture important failures and gaps
5. connect operations to concepts and rules

## Prompt set

- what business action is being requested?
- what fact happens afterward?
- what questions must the system answer?
- what concepts are changed or read?
- what are the important failure modes?

## Free-text intake template

- **Operation or question name:**
- **Kind (request/fact/read/document/question):**
- **Purpose:**
- **What it affects or returns:**
- **What may happen next:**
- **Related concepts/rules:**
- **Important errors or gaps:**

## Worked example

- Submit Return Request is a request to create a return request
- Return Request Submitted is the fact that follows successful submission
- Get Return Eligibility answers whether the selected items can still be returned
- Return Window Error appears when selected items fall outside the allowed return policy

## Layer-specific handoff guidance

For domain notes, the handoff should preserve **causal meaning**.

The receiver should be able to tell:

- what is a request versus a fact versus a read
- what each operation changes or answers
- what errors or unanswered questions matter

If the handoff reads like UI clicks instead of business operations, it needs another pass.

## How this becomes YAML

A technical modeler or AI agent can transform this into domain operations, questions, and errors,
linking them to concepts, stories, and rules.

## Common mistakes

- mixing user-interface actions with domain operations
- describing only labels and not effects
- forgetting the difference between a request and a fact
- omitting important errors or unanswered questions