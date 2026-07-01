# Blueprint Authoring Atlas

This guide family is for **non-technical contributors** who need to describe a business, process,
screen flow, concept, risk, or decision clearly enough that a technical modeler or AI agent can
turn that description into Blueprint YAML.

This is **not** a schema reference. It explains **what knowledge to capture**, **how to express
it**, and **how to hand it off**.

## What you are trying to do

Blueprint authoring starts from plain language:

- name the important **things** in the domain
- describe the **relationships** between them
- explain the **flows** and **working steps**
- capture the **screens/interactions** people use
- record **rules, goals, risks, evidence, and decisions**

If that knowledge is clear, a technical person or AI agent can transform it into YAML. If that
knowledge is vague, mixed, or contradictory, the YAML will also be vague, mixed, or contradictory.

## How to use this guide family

1. Start with the layer that best matches the knowledge you have.
2. Write plain-language notes using the prompts in that guide.
3. Keep one kind of knowledge in one layer as much as possible.
4. Hand the text to a technical modeler or AI agent for YAML transformation.
5. Review the result together and correct missing or wrong meaning.

## What makes good input

Good authoring input is:

- **concrete** — it names real actors, things, actions, and outcomes
- **layer-aware** — it does not mix concepts, screens, stories, and risks into one blob
- **connected** — it explains relationships, not only isolated items
- **outcome-focused** — it explains what changes, not only what exists
- **reviewable** — another person can read it and point out gaps or contradictions

## The layers at a glance

Use these guides depending on what you are trying to capture:

| Guide | Use it when you need to describe | Current status |
| --- | --- | --- |
| [Story](./design-story.md) | journeys, processes, activities, steps, and outcomes | first wave |
| [Interactions](./design-interactions.md) | screens, actions, responses, navigation, and user-system exchanges | first wave |
| [Concepts](./design-concepts.md) | business terms, entities, identities, relationships, and state meaning | first wave |
| Architecture | system structure, boundaries, services, integrations | planned |
| Domain | operations, events, queries, causal changes | planned |
| Dynamics | ordering, timing, race conditions, parallel work | planned |
| Infrastructure | deployment/runtime/integration infrastructure | planned |
| Models | data shapes crossing boundaries or shown to users | planned |
| Quality | measures, KPIs, SLOs, qualities, acceptance thresholds | planned |
| Rules | obligations, prohibitions, transitions, constraints | planned |
| Capability | stable business abilities | planned |
| Decisions | explicit rationale and trade-offs | planned |
| Motivation | goals, assumptions, risks, opportunities | planned |
| Organization | parties, teams, roles, ownership | planned |
| Roadmap | milestones and delivery framing | planned |
| Test Cases | scenarios proving behavior and constraints | planned |
| Value Stream | end-to-end value stages across capabilities | planned |

## How plain-language capture becomes YAML

There are two roles in the handoff:

- **non-technical contributor**
  - explains the real-world meaning
  - provides examples, context, and relationships
  - confirms whether the transformed output is faithful
- **technical modeler or AI agent**
  - maps the capture into the right Blueprint layer
  - structures the content into YAML
  - resolves references, IDs, and traceability
  - asks follow-up questions where the source text is incomplete

The goal is **faithful transformation**, not inventing meaning that was never captured.

## What `blueprint.schema` means for authors

You do **not** need to study `blueprint.schema` directly.

What matters for you is this:

- it describes the overall contract of a Blueprint bundle
- it is why the final model needs enough structure and completeness
- it is why mixed-up or contradictory input creates problems later

In simple terms: it is the reason your input needs to be clear and well separated by layer.

## What `metamodel.schema` means for authors

You do **not** need to read `metamodel.schema` line by line.

What matters for you is this:

- it is the shape behind the Blueprint language
- it is why consistent naming matters
- it is why the same concept should not be described three different ways in three different guides

In simple terms: it is the reason vocabulary and relationships must stay consistent.

## What migrations mean for authors

Blueprint evolves over time. Migrations exist because the language changes.

For authors, this means:

- older notes may need updating before reuse
- examples from earlier versions may not map perfectly to the latest guide set
- keeping capture clear and plain-language makes migration easier

In simple terms: if the language evolves, clear source thinking survives better than tool-specific wording.

## Cross-layer consistency checklist

Before handing off your notes, check:

- are the same **names** used consistently?
- are the same **concepts** described the same way in every guide?
- do **stories**, **interactions**, and **concepts** refer to one another clearly?
- are **actors** named consistently?
- are **outcomes**, **rules**, and **risks** stated without contradiction?

## Recommended capture workflow

1. Start with rough notes from interviews, workshops, or observation.
2. Move the notes into the right layer guide.
3. Fill missing actors, relationships, steps, and outcomes.
4. Hand the result to a technical modeler or AI agent.
5. Review the transformed YAML for fidelity.
6. Correct meaning first, formatting second.

## Common mistakes

- mixing screens, concepts, stories, and risks into one document
- describing UI layout but not user intent
- naming activities without outcomes
- naming concepts without relationships
- using examples as if they were the whole rule
- writing implementation details before business meaning is clear

## Start here

Use these first:

- [Story authoring guide](./design-story.md)
- [Interactions authoring guide](./design-interactions.md)
- [Concepts authoring guide](./design-concepts.md)