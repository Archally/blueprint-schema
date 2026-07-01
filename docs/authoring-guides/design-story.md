# Story Authoring Guide

Use this guide when you need to describe a **journey, process, use case, activity sequence, or
business story**.

This guide is about **what happens**, **who is involved**, **what changes**, and **what outcome is
reached**.

## What belongs here

Capture things like:

- a user journey
- a business process
- a service flow
- a use case
- a sequence of activities and steps
- success, error, and exception paths

## What does not belong here

- full definitions of business concepts — put those in the Concepts guide
- detailed screen behavior — put that in the Interactions guide
- formal rules and constraints — describe them here only briefly and link them conceptually

## Core things to capture

Describe:

- **who** starts the story
- **why** the story exists
- **what activities** happen
- **what steps** happen inside those activities
- **what triggers** the next part
- **what success looks like**
- **what can go wrong**
- **what other concepts, screens, or rules are involved**

## Core relationships to capture

Make these links explicit in your text:

- actor -> story
- story -> activity
- activity -> step
- step -> next step or next activity
- story -> concepts involved
- story -> screens/interactions involved
- story -> outcomes, risks, or rules that matter

## Modus operandi

When eliciting a story, work in this order:

1. name the **goal**
2. identify the **actor**
3. describe the **main happy path**
4. split the flow into **activities**
5. add important **steps** inside each activity
6. add **exceptions**, **errors**, and **alternate paths**
7. list the concepts and screens involved

Focus on the business meaning of the flow, not on technical implementation.

## Prompt set

Use questions like these:

- who wants something to happen?
- what starts the flow?
- what is the first meaningful activity?
- what happens next, and why?
- what is the expected outcome?
- what can fail?
- what other people or systems take part?
- what business concepts are changed, read, or created?

## Free-text intake template

Use this template when gathering notes:

- **Story name:**
- **Goal:**
- **Primary actor(s):**
- **Trigger:**
- **Main outcome:**
- **Activities:**
  - Activity 1:
    - purpose:
    - steps:
    - result:
  - Activity 2:
    - purpose:
    - steps:
    - result:
- **Error or alternate paths:**
- **Concepts involved:**
- **Screens or interactions involved:**
- **Important rules or risks:**

## Worked example

### Example: employee submits a leave request

- **Goal:** an employee asks for time off and receives a decision
- **Primary actor:** employee
- **Trigger:** employee decides to request leave
- **Main outcome:** leave request is approved or rejected
- **Activities:**
  - Create request
    - employee enters dates and reason
    - system records the request
  - Review request
    - manager checks coverage and policy
    - manager approves or rejects
  - Notify employee
    - system sends the decision
- **Error or alternate paths:**
  - request overlaps a blocked period
  - request is missing information
  - manager rejects due to staffing constraints
- **Concepts involved:** employee, leave request, leave balance, approval decision
- **Screens involved:** leave request form, manager review screen, confirmation/decision screen

## How this becomes YAML

A technical modeler or AI agent can transform this into a story layer by:

- turning the story into a named business narrative
- turning activities into ordered story activities
- mapping key steps to business operations
- linking actors, concepts, and screens
- separating happy path and error path behavior

You do not need to produce IDs or YAML field names yourself.

## Common mistakes

- listing steps without the overall goal
- mixing several unrelated stories together
- describing only the happy path
- naming activities but not the result of each activity
- using UI button names instead of business actions
- forgetting which concepts are affected by the story