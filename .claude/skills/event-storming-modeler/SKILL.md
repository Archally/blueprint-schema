---
name: event-storming-modeler
description: Event Storming syntax, workflow, and best practices for collaborative domain modeling. Use when facilitating or designing Event Storming workshops, translating blueprint models to/from Event Storming, working with domain events/commands/policies/read models, or when Big Picture, Process Modeling, or Software Design Event Storming formats are relevant.
---

# Event Storming Modeling

Event Storming is a flexible collaborative workshop format invented by Alberto Brandolini (~2013) for exploring complex business domains beyond silo boundaries. It uses a lo-fi notation based on colored sticky notes and a timeline (left-to-right, parallel streams top-to-bottom).

---

## When to use

- Facilitating or designing Event Storming workshops
- Translating blueprint models to Event Storming views (Big Picture, Process, Software Design)
- Working with domain events, commands, policies, read models, actors, systems
- Discovering bounded contexts, process bottlenecks, or software design options
- Aligning teams around shared domain understanding
- When the user asks about Event Storming syntax, workflow, facilitation, or sticky note conventions

---

## Syntax (Color-Coded Sticky Notes)

| Color | Concept | Use |
| --- | --- | --- |
| **Orange** | Domain Event | Past tense verb; something that happened ("Order Placed"). Primary concept - everything builds around events. |
| **Blue** | Command / Action | Imperative form; triggers an event ("Place Order"). Placed left of the corresponding event. |
| **Small Yellow** | Actor / Agent | Person, team, or department involved in events or triggering commands. |
| **Wide Pink** | System | Deployable IT system (Excel, microservice, etc.) that responds to events. |
| **Neon Pink** (pivoted) | Hotspot | Conflict, inconsistency, question, dissent, or pain point - capture for later. Often more valuable than the events. |
| **Green** | Opportunity / Value | Positive possibilities or explicit value; use after a consistent timeline. |
| **Red/Green (small)** | Value | Value stream: positive (green) or negative (red) value at a step. |
| **Big Lilac** | Policy | "Whenever X happens, do Y" - automated or manual reaction linking event → command. |
| **Green** | Query Model / Information | Information needed to make decisions; alternatives: "read model", "view". |
| **Big Yellow** | Constraint | Business rule or invariant (formerly "aggregate"); restriction when performing a command. |

**Note:** Different formats (Big Picture, Process, Software Design) introduce concepts progressively. Avoid jargon with business stakeholders - "Action" may work better than "Command".

---

## Workshop Styles

| Style | Goal | Audience & Scale |
| --- | --- | --- |
| **Big Picture** | Assess health of a line of business; explore viability of a startup or ecosystem. Discover emerging bounded contexts. | 10–30+ people, one paper roll. |
| **Improve** | Dig into business flow; uncover inconsistencies, impediments; gather consensus on next actions. | Cross-functional, strategic. |
| **Envision** | Explore new ecosystem; enforce consistent storytelling; highlight architectural boundaries. | Stakeholders and partners. |
| **Explore** | Design services collaboratively; manage value, emotions, and risks. | Business, service designers, IT. |
| **Process Modeling** | Assess current process health; find bottlenecks; identify decoupling points. | Process-focused teams. |
| **Software Design** | Design event-driven software for critical processes; design aggregates, commands, policies. | Engineers + domain experts. |

---

## Workflow Steps

1. **Check-in** - Everyone shares briefly (non-work); set agreements (e.g. Deep Democracy: learn together, deepen relationships, nobody has monopoly on truth).
2. **Chaotic exploration** - Each person writes domain events alone; place on paper in the order they think events happen. Don’t discuss yet; avoid biasing others.
3. **Enforce the timeline** - Order events left-to-right; remove duplicates (discuss if same language, different concepts); add tape/structure only when needed.
4. **Hotspots** - Add neon pink stickies where conflicts, questions, or pain points arise. Facilitator often adds these.
5. **Add concepts progressively** - Commands, actors, systems, policies, read models, constraints; introduce via a visible legend.
6. **Pivotal events / swimlanes** - Identify the few most significant events; optionally separate into swimlanes by actor/department.
7. **Check-out** - Circle; each person shares a takeaway; step in if they agree with someone’s statement.

---

## Facilitation Best Practices

### Preparation

- Invite everyone who brings and needs knowledge (domain experts, engineers, designers).
- Send intro materials (e.g. Brandolini "50,000 Orange Stickies Later" video) plus eventstorming.com resources.
- Provide modeling surface (6–8 m paper roll or virtual board), markers, sticky notes, visible legend.
- No seats near the wall; table for materials; fresh air, food, candies.
- Dedicated facilitator - neutral, observes, intervenes when needed.

### During

- Let the group figure things out; decide for them when they can’t.
- Give feedback on group dynamics (e.g. "I see part of the group is distracted").
- First in, last out - set up and debrief.
- Use the "flip 45°" trick for poorly written stickies (rotate instead of criticizing).
- If one person bottlenecks, split groups to work on different sections.
- Track decisions on a flip chart; use hotspots to park long discussions.
- Online: Miro templates for Process Modeling and Software Design; Big Picture prefers in-person.

### Legend

- Keep a visible legend; add concepts as they appear.
- Avoid jargon; "aggregate" → "constraint" with stakeholders.

---

## Blueprint Integration

This project has an Event Storming view under `views/event-storming/` that:

- Translates blueprint stories, domain events, commands, operations → Event Storming timeline.
- Supports Big Picture, Process, and Software Design models.
- Produces artifacts: events, commands, policies, read models, actors, systems, constraints, hotspots, opportunities.
- Diffs between versions via `esDiff.ts`.

### Blueprint → ES mapping

- `story.yaml` stories → timeline segments with operations (events, commands, read models).
- Domain layer entities → events, commands, queries.
- `arch.yaml` components → systems; actors from `initiated_by`.
- Hotspots and opportunities can be inferred or added manually.

---

## Sources

- **Official:** [eventstorming.com](https://www.eventstorming.com/) - book, resources, starter kit.
- **Glossary & cheat sheet:** [ddd-crew/eventstorming-glossary-cheat-sheet](https://ddd-crew.github.io/eventstorming-glossary-cheat-sheet/)
- **Book:** Alberto Brandolini, "Introducing EventStorming" (Leanpub).
- **Videos:** "50,000 Orange Stickies Later", "100,000 Orange Stickies Later", "Extreme Modelling Patterns".
- **Medium:** Alberto Brandolini, "Collaborative Process Modelling with EventStorming"; facilitation recipes.
- **Articles:** Avanscoperta, Verraes facilitation, Remote EventStorming (COVID-era).
- **Community:** Paul Rayner, Kenny Baas-Schwegler, Mariusz Gil (awesome-eventstorming GitHub).
