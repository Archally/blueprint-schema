# Test Cases Authoring Guide

Use this guide when you need to describe **scenarios that prove expected behavior, edge behavior,
error behavior, or architectural fitness constraints**.

This guide is about evidence that the model or system behaves as intended.

## What belongs here

- happy-path scenarios
- edge-case scenarios
- error-case scenarios
- architectural fitness checks

## What does not belong here

- a full business story without expected results
- vague quality wishes with no scenario or assertion
- implementation test code

## Core things to capture

- the scenario name
- what is being tested
- setup/preconditions
- expected behavior or result
- what Blueprint element it validates

## Core relationships to capture

- test case -> operation/rule/concept/story validated
- fitness function -> structural constraint checked
- scenario -> expected outcome or failure mode

## Modus operandi

Capture evidence in scenario form:

1. describe the setup
2. describe the triggering action
3. describe the expected result
4. identify what Blueprint element is being validated
5. separate happy, edge, and error cases

## Prompt set

- what scenario are we proving?
- what is the setup?
- what action occurs?
- what should happen?
- what rule, concept, or operation does this validate?

## Free-text intake template

- **Test name:**
- **Category (happy/edge/error/fitness):**
- **Setup/preconditions:**
- **Trigger/action:**
- **Expected result:**
- **Validates:**

## Worked example

- Happy path: employee submits valid leave request and receives confirmation
- Edge case: employee submits request with the maximum allowed future range
- Error case: employee submits overlapping dates and receives validation failure

## How this becomes YAML

A technical modeler or AI agent can transform this into categorized test cases and fitness
functions linked to the relevant Blueprint entities.

## Common mistakes

- naming the test but not the expected result
- forgetting what is being validated
- mixing many scenarios into one case
- omitting edge and error behavior