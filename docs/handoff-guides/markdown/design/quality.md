# Quality Handoff Guide

Use this guide when you need to describe **measures, targets, security, compliance, resilience,
observability, or important quality findings**.

This guide is about **how good is good enough**, **how it is measured**, and **what quality risks or
obligations matter**.

## Knowledge area

This guide helps with **quality expectations and measures**. Technically, it covers **quality
attributes and measurable fitness**.

## What belongs here

- metrics and KPIs
- service targets such as response time or uptime
- security requirements
- compliance and retention requirements
- resilience and recovery expectations
- observability expectations
- important quality findings or internal weaknesses

## What does not belong here

- broad business goals without measurable or quality meaning
- the whole process flow
- static infrastructure inventory by itself

## Core things to capture

- what should be measured
- what target or threshold matters
- what quality requirement must hold
- what risk or weakness already exists
- what evidence or monitoring should exist

## Core relationships to capture

- goal -> KPI/metric
- operation/service -> SLO/SLA
- concept/data -> security or compliance rule
- system area -> resilience or observability need
- quality finding -> risk or remediation concern

## Modus operandi

Capture quality by asking:

1. what matters to stakeholders?
2. how would we measure it?
3. what minimum acceptable target exists?
4. what obligations or protections apply?
5. what known weaknesses need visibility?

## Prompt set

- what must be fast, accurate, secure, or reliable?
- how do we know whether it is good enough?
- what happens if it fails?
- what regulations or obligations apply?
- what quality problems already exist today?

## Free-text intake template

- **Quality concern:**
- **Why it matters:**
- **What is measured or required:**
- **Target or threshold:**
- **Affected operations/concepts/services:**
- **Evidence/monitoring needed:**
- **Known findings or risks:**

## Worked example

- Leave approval decision should be visible to the employee within 30 seconds of manager action
- Personal leave data must be retained and accessed under privacy rules
- Audit logs must capture approval changes

## Layer-specific handoff guidance

For quality, the handoff should make **expectations testable**.

The receiver should be able to see:

- what quality concern matters
- how it is measured or observed
- what threshold or obligation exists
- what happens if it is not met

If the wording is only "important" or "better", the handoff is too vague.

## How this becomes YAML

A technical modeler or AI agent can transform this into metrics, KPIs, SLOs, security,
compliance, resilience, observability, and findings entries.

## Common mistakes

- saying something is important without a measurable meaning
- mixing business goals with operational targets
- forgetting security/compliance obligations
- omitting known quality weaknesses because they feel uncomfortable