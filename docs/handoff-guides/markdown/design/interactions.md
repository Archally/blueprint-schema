# Interactions Handoff Guide

Use this guide when you need to describe **screens, views, user actions, system responses, and
navigation between screens**.

This guide is about **what the user sees**, **what the user can do**, and **how the interface moves
from one state or screen to another**.

## Knowledge area

This guide helps with **screens and user interaction flow**.

## Main entities in this guide

- `screen` — a UI surface a person sees.
- `action` — something a person can do on a screen.
- `navigation` — how one screen leads to another.
  - Often confused with: a story step. An `action` is a user-system interaction moment; a story
    step is part of a broader business journey.

## What belongs here

Capture things like:

- screens and views
- user actions on those screens
- feedback, validation, and response states
- transitions from one screen to another
- important links to stories, concepts, or rules

## What does not belong here

- the whole business process — capture that in the Story guide
- full definitions of concepts — capture those in the Concepts guide
- technical implementation details of frontend components unless they change meaning

## Core things to capture

Describe:

- the **screen name** and purpose
- what information the user **sees**
- what the user can **do**
- what the system **responds with**
- what happens after the action
- what errors, validations, or blocked states exist

## Core relationships to capture

Make these links explicit in your text:

- screen -> action
- action -> result/state
- screen -> next screen
- screen -> concepts displayed or edited
- interaction -> story or user goal served
- interaction -> rule, decision, or test concern if important

## Modus operandi

Walk through the interaction as if you were following a user:

1. identify the entry screen
2. describe what the user sees first
3. list available actions
4. describe the response to each important action
5. describe where the user goes next
6. capture error, validation, and empty states

Focus on user intent and system feedback, not on pixel-perfect layout.

## Prompt set

Use questions like these:

- what does the user see first?
- what can the user do from here?
- what information is required before continuing?
- what happens after the user acts?
- what confirmations, errors, or warnings appear?
- where does the user go next?
- which concepts are being viewed or changed?

## Free-text intake template

Use this template when gathering notes:

- **Screen name:**
- **Purpose:**
- **User type / actor:**
- **What the user sees:**
- **Main actions available:**
- **System responses:**
- **Validation or error states:**
- **Navigation:**
  - from:
  - to:
  - when:
- **Concepts shown or edited:**
- **Related story or goal:**

## Worked example

### Example: return request form

- **Screen name:** Return Request Form
- **Purpose:** let a customer submit a return request
- **What the user sees:** order items, return reason, refund method, eligibility summary
- **Main actions:** submit request, save draft, cancel
- **System responses:**
  - on valid submit, show confirmation and send request for review
  - on invalid item selection, show a validation error
  - on policy conflict, show warning and block submission
- **Navigation:**
  - from order details page to return request form
  - from return request form to confirmation page after successful submit
- **Concepts shown or edited:** customer, order item, return request, refund option
- **Related story:** customer submits a return request

## Layer-specific handoff guidance

For interactions, the handoff should preserve **user intent and visible behavior**.

The receiver should be able to tell:

- what the user sees
- what the user can do
- what the system responds with
- where the user goes next

If a screen is described only by layout and not by action/result, the handoff is incomplete.

## How this becomes YAML

A technical modeler or AI agent can transform this into an interactions layer by:

- turning screens into named UI views
- turning actions into user-triggered interaction points
- turning navigation into directed transitions
- linking screens and actions to related stories, concepts, goals, or rules

You do not need to describe screen IDs or field-level schema structure.

## Common mistakes

- describing layout but not user purpose
- naming actions without describing their results
- forgetting validation/error states
- forgetting navigation after success or failure
- mixing business-process detail and UI detail into one undifferentiated list
- omitting the concepts that the screen displays or changes