# Rules Authoring Guide

Use this guide when you need to describe **constraints, validations, classifications, derivations,
equivalences, and state transitions**.

This guide is about **what must be true**, **what is allowed**, and **how values or states are
determined**.

## What belongs here

- invariants that must always hold
- validation requirements at boundaries
- rules that classify something
- rules that derive a value
- transition rules between states

## What does not belong here

- a whole story flow
- raw concept definitions without a rule
- generic design preferences disguised as mandatory business rules

## Core things to capture

- the rule statement
- when it applies
- what it requires or forbids
- which concepts or states it affects
- what happens if it is violated

## Core relationships to capture

- rule -> concept affected
- rule -> state transition controlled
- rule -> operation or screen where it matters
- rule -> business consequence if broken

## Modus operandi

Write rules as explicit business statements:

1. name the rule
2. describe when it applies
3. describe what must or must not happen
4. identify concepts, states, and outcomes affected
5. separate rule meaning from implementation technique

## Prompt set

- what must always be true?
- what is forbidden?
- what decides the category or status?
- how is a value derived?
- what conditions allow a state change?

## Free-text intake template

- **Rule name:**
- **Type (constraint/validation/classification/derivation/transition):**
- **When it applies:**
- **What it requires or forbids:**
- **Affected concepts/states:**
- **Business consequence if broken:**

## Worked example

- A leave request may not be approved if remaining leave balance is insufficient
- A medical leave request must be classified separately when documentation is required
- A submitted leave request may transition to approved, rejected, or cancelled

## How this becomes YAML

A technical modeler or AI agent can transform this into structural, validation, classification,
derivation, equivalence, or transition rule entries linked to concepts and operations.

## Common mistakes

- describing a habit or preference as if it were a rule
- forgetting when the rule applies
- mixing process narrative with rule definition
- omitting the affected concept or state