# Infrastructure Handoff Guide

Use this guide when you need to describe **environments, operational resources, platform services,
and deployment topology**.

This guide is about the **resources the system depends on** and **where they live**.

## Knowledge area

This guide helps with the **operational environment and supporting technology**. Technically, it
covers **operational environment and platform topology**.

## Main entities in this guide

- `environment` — a named operating environment such as development, staging, or production.
- `resource` — an infrastructure element the system depends on, such as storage, compute, or
  messaging.
- `topology` — the high-level deployment shape showing how environments and resources fit together.
- `deployment_tier` — a layer inside the topology, such as edge, application, or data.
  - Often confused with: `resource_profile` in Dynamics. Infrastructure `resource` names what
    exists; Dynamics explains how runtime behavior uses it.

## What belongs here

- databases, queues, storage, caches, APIs, external services
- environments such as dev, staging, prod
- deployment tiers or placement
- resource ownership and responsibility

## What does not belong here

- business concepts and rules
- business process stories
- screen-level interaction behavior

## Core things to capture

- what resources exist
- what each resource is for
- which environments matter
- who owns or supports each resource
- how major services are placed or connected

## Core relationships to capture

- service/component -> resource used
- resource -> environment
- resource -> owner/support team
- tier/region -> deployed services/resources

## Modus operandi

Describe infrastructure in terms of purpose and operational dependency:

1. list the important resources
2. group them by environment or operational role
3. capture who owns them
4. capture which major services depend on them
5. capture meaningful topology only, not every internal knob

## Prompt set

- what operational resources does this system need?
- which environments matter?
- who is responsible for each resource?
- what depends on what?
- what placement or topology matters to the reader?

## Free-text intake template

- **Resource name:**
- **Kind/type:**
- **Purpose:**
- **Environment(s):**
- **Owner/support team:**
- **Used by:**
- **Important topology notes:**

## Worked example

- Commerce SQL Database stores order and return data in dev, staging, and prod
- Notification Queue is used by return confirmation and refund update flows
- Reporting Service runs separately and consumes replicated data

## Layer-specific handoff guidance

For infrastructure, the handoff should emphasize **operational dependency and responsibility**.

The receiver should quickly understand:

- what resources exist
- what each one is for
- who owns or supports it
- what major services depend on it

Avoid handoffs that are only inventories; include purpose and ownership.

## How this becomes YAML

A technical modeler or AI agent can transform this into infrastructure resources, environments,
owners, and topology entries.

## Common mistakes

- listing resources without purpose
- mixing architecture/service logic with raw resource inventory
- forgetting environments
- omitting ownership or operational responsibility