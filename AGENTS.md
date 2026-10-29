# public-blueprint-modeler

Limited blueprint-modeling kit that needs no Archally CLI and no MCP server - public modeling agent + methodology skills, for Claude Code, Codex and Cursor.

**Covers:** `blueprint`. Use this method when a request is about that work. Every other request
follows the project's own instructions (and its `CONTRIBUTING.md`, where one exists); this file
does not restrict it.

## Start here

- **Claude Code**: the `blueprint-modeler` subagent (`.claude/agents/blueprint-modeler.md`); the commands below run as slash commands.
- **Codex**: the `blueprint-modeler` custom agent (`.codex/agents/blueprint-modeler.toml`, loaded in a trusted project). Without it,
  read `.agents/agents/blueprint-modeler.md` and follow it. To run a command below, read <!-- public-docs-scan:allow Codex and Cursor read this path -->
  `.agents/commands/<name>.md` and follow it. <!-- public-docs-scan:allow Codex and Cursor read this path -->
- **Cursor**: the `blueprint-modeler` subagent (`.cursor/agents/blueprint-modeler.md`); the commands below run as slash commands.

## Skills - load on demand, do not read them all up front

- `architecture-visualization` - Architecture visualization and communication methods.
- `blueprint-chains` - The 21 cross-layer traceability chains and feedback loops a blueprint carries - each hop as a typed reference (From -…
- `blueprint-exchange-binding` - Use when binding a blueprint slice's operations to their transport - filling the `exchange` + `payload` blocks in `do…
- `blueprint-validate` - Validate blueprint YAML against the Archally Blueprint Schema using the schema repository's local validator, semantic…
- `capability-mapping` - Use when building a business capability map (stable "what the business can do", hierarchical, technology-independent)…
- `cognitive-tools` - Thinking archetypes and cognitive tools.
- `ddd-modeling` - Use when applying Domain-Driven Design while authoring an Archally blueprint - finding bounded contexts and their rel…
- `domain-discovery` - Domain discovery and knowledge elicitation methods.
- `event-storming-modeler` - Event Storming syntax, workflow, and best practices for collaborative domain modeling.
- `first-principles-thinking` - Reframe a domain, subject, or task from first principles before answering, planning, or implementing.
- `formalization-and-modeling` - Formalization and modeling languages for expressing domain models precisely.
- `learned-rules` - How this repo records modeling lessons it has already paid for, and how to send a lesson back upstream so the next re…
- `sbvr-business-rules` - Use when modeling business rules, invariants, constraints, and state transitions in an Archally blueprint using SBVR…
- `schema-gotchas` - Shapes in the Blueprint Schema that commonly trip up an author - map-vs-list collections, `name` vs `statement`, item…
- `test-case-traceability` - Use when linking a blueprint slice's test-cases to the real automated tests that verify them - attaching code_refs (r…

## Commands

`/blueprint-check-all` · `/blueprint-new`

Reach for one when its subject comes up. This file is loaded with every request, so it is
deliberately short - the detail lives in the skills, not here.
