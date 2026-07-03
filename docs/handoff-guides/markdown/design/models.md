# Models Handoff Guide

Use this guide when you need to describe **data shapes that cross boundaries or are shown clearly to
users or other systems**.

This guide is about **what information is carried**, **how it is grouped**, and **what it
represents**.

## Knowledge area

This guide helps with **information shapes and views**. Technically, it covers **information
structures and data representations**.

## What belongs here

- request payload shapes
- event payload shapes
- read models shown to users
- shared data transfer objects
- reusable fields or parameters when they have stable meaning

## What does not belong here

- business concept meaning by itself
- UI flow behavior
- purely internal technical structures with no cross-boundary value

## Core things to capture

- what information package exists
- what it is used for
- what main fields it contains
- what concept or business meaning it represents
- who sends or receives it

## Core relationships to capture

- model -> concept represented
- model -> operation using it
- model -> screen or view showing it
- field -> business meaning

## Modus operandi

Think in information bundles:

1. identify what data crosses a boundary or is shown together
2. describe its purpose
3. list the important fields in business language
4. explain what concept it represents
5. note who produces and consumes it

## Prompt set

- what information travels together?
- why does this shape exist?
- who sends it and who receives it?
- what business concept does it represent?
- which fields are essential to understand the payload?

## Free-text intake template

- **Model name:**
- **Purpose:**
- **Produced by / consumed by:**
- **Represents:**
- **Important fields:**
- **Where it is displayed or used:**

## Worked example

- Leave Request Summary model is used on the employee dashboard and manager review page
- It represents a leave request and includes employee name, dates, status, and decision summary

## Layer-specific handoff guidance

For models, the handoff should preserve **information shape and business meaning together**.

Make sure the receiver can see:

- what bundle of information exists
- why that bundle exists
- who produces or consumes it
- what concept it represents

Field lists without meaning are weak handoffs; add purpose and representation context.

## How this becomes YAML

A technical modeler or AI agent can transform this into reusable data models and field definitions
linked to operations, concepts, and views.

## Common mistakes

- listing every storage column instead of the meaningful data shape
- omitting the purpose of the model
- describing fields with technical names only
- forgetting what concept the model represents