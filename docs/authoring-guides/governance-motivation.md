# Motivation Authoring Guide

Use this guide when you need to describe **goals, non-goals, risks, assumptions, trade-offs, and
open governance questions**.

This guide is about **why** the system exists and what strategic forces shape it.

## What belongs here

- goals and desired outcomes
- non-goals and boundaries
- risks and threats
- assumptions that may prove wrong
- trade-offs between competing concerns
- unresolved strategic questions

## What does not belong here

- detailed process steps
- final decisions without their surrounding motivation
- raw metrics without a strategic purpose

## Core things to capture

- what is being aimed for
- what is intentionally out of scope
- what could go wrong
- what is being assumed
- what tension exists between important concerns

## Core relationships to capture

- goal -> quality measure or capability supported
- risk -> goal threatened
- assumption -> consequence if false
- trade-off -> concerns being balanced
- inquiry -> decision or clarification needed

## Modus operandi

Use motivation to make implicit reasoning visible:

1. state the goals clearly
2. name what is out of scope
3. identify risks and assumptions
4. capture tensions and trade-offs
5. record unresolved questions that block good decisions

## Prompt set

- what are we trying to achieve?
- what are we explicitly not trying to do?
- what could threaten the goal?
- what are we assuming is true?
- what tensions do we accept consciously?

## Free-text intake template

- **Goal / non-goal / risk / assumption / trade-off / inquiry:**
- **Statement:**
- **Why it matters:**
- **What it affects:**
- **Consequence if ignored or false:**

## Worked example

- Goal: employees can submit leave requests without HR mediation
- Risk: inconsistent manager decisions create fairness concerns
- Assumption: managers understand leave policy well enough to decide quickly
- Trade-off: faster local decisions vs stronger centralized consistency

## How this becomes YAML

A technical modeler or AI agent can transform this into motivation entries that later connect to
decisions, quality measures, and capabilities.

## Common mistakes

- writing vague goals with no clear intent
- hiding assumptions inside decision text
- omitting non-goals
- listing risks without saying what they threaten