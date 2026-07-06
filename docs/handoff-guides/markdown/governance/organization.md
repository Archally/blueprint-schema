# Organization Handoff Guide

Use this guide when you need to describe **parties, departments, teams, and ownership**.

This guide is about **who is responsible**, **how groups are arranged**, and **who owns what**.

## Knowledge area

This guide helps with **teams, ownership, and responsibilities**.

## Main entities in this guide

- `party` — the highest-level organizational owner in this guide.
- `department` — a subdivision inside a party.
- `team` — the working group that owns or delivers a slice of responsibility.
  - Often confused with: `party` in the Architecture guide. Organization is about ownership
    structure; Architecture is about structural system boundaries.

## What belongs here

- companies, business units, or system-owning parties
- departments
- teams
- ownership relationships

## What does not belong here

- capability maps
- process flows
- technical architecture details unless they clarify ownership

## Core things to capture

- what parties exist
- what departments exist under them
- what teams exist under them
- what each group is responsible for
- what important ownership boundaries matter

## Core relationships to capture

- party -> department
- party -> team
- team -> owned area/artifact/capability
- department -> grouped teams

## Modus operandi

Describe organization for accountability:

1. identify the top-level parties
2. identify departments and teams
3. describe responsibility boundaries
4. connect ownership to system or business areas

## Prompt set

- who owns this domain or system?
- what groups exist?
- what is each group responsible for?
- where does accountability change hands?

## Free-text intake template

- **Party name:**
- **Departments:**
- **Teams:**
- **Responsibility summary:**
- **Owned areas/artifacts:**

## Worked example

- Commerce Operations party includes Returns Policy department and Storefront Experience team
- Storefront Experience team owns the return request workflow and customer account experience

## Layer-specific handoff guidance

For organization, the handoff should make **accountability** easy to trace.

The receiver should quickly understand:

- what parties, departments, and teams exist
- what each one owns
- where responsibility changes hands

If ownership is fuzzy or implied, the handoff is not yet strong enough.

## How this becomes YAML

A technical modeler or AI agent can transform this into party, department, and team structures plus
ownership references elsewhere in the Blueprint.

## Common mistakes

- listing job titles instead of real responsible groups
- omitting ownership boundaries
- mixing temporary project groups with stable organizational ownership