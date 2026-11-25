# Model setup

You can use the AI agent kit or write the YAML yourself. Start from the prepared clone in the
[quick start](../README.md#quick-start).

## AI agent kit

The kit includes the [blueprint-modeler agent](../.agents/agents/blueprint-modeler.md), the [blueprint-new command](../.agents/commands/blueprint-new.md), the [blueprint-check-all command](../.agents/commands/blueprint-check-all.md), and fifteen method skills, including [ddd-modeling](../.agents/skills/ddd-modeling/SKILL.md), [event-storming-modeler](../.agents/skills/event-storming-modeler/SKILL.md), and [capability-mapping](../.agents/skills/capability-mapping/SKILL.md). <!-- public-docs-scan:allow Codex and Cursor read this path -->

Open the cloned folder itself after `npm install` and `npm run build`. Installation fetches
dependencies and the build compiles the local tools. Run them as separate preparation steps.

| Host | Find and run the kit |
| --- | --- |
| Claude Code | The agent and commands are available in `.claude/`. Invoke `/blueprint-new my-training-model Training model` directly. |
| Cursor | The agent and commands are available in `.cursor/`. Cursor reads skills in `.agents/skills/`. Invoke `/blueprint-new my-training-model Training model` directly. | <!-- public-docs-scan:allow Cursor reads this path -->
| Codex | After you trust the project, Codex loads [the custom agent](../.codex/agents/blueprint-modeler.toml). Codex reads skills in `.agents/skills/` and command files in `.agents/commands/`. Ask it to follow the linked command file using the request in the quick start. | <!-- public-docs-scan:allow Codex reads these paths -->

The `.agents/` tree contains the source kit. The Claude Code, Cursor, and Codex host files are generated from it. <!-- public-docs-scan:allow Codex and Cursor read this path -->

The first argument to `/blueprint-new` is the project directory. The command creates and checks a
seed in `.blueprint/v2.8/` beneath that directory and stops if it already contains a model.

The kit works with the clone's local checks, without the Archally Pro CLI or an MCP server.
See the [host instructions](ai-agent-kit.md#how-each-host-finds-the-kit), [how to check that it
works](ai-agent-kit.md#check-that-it-works), and [how to use it in another
project](ai-agent-kit.md#use-the-kit-in-another-project).

## Write two files yourself

From the cloned repository, create `my-training-model/.blueprint/v2.8/blueprint.yaml`.

```yaml
version: "1.0.0"
name: "Training model"
```

Create `my-training-model/.blueprint/v2.8/training/concepts.yaml`.

```yaml
version: "1.0.0"
concepts:
  - id: CN001
    name: "Workshop"
    stereotype: aggregate-root
    description: "A scheduled learning session with a defined capacity."
```

This two-file seed introduces CN001 (Workshop). Add detail as you learn and [run the local
checks](../README.md#3-check-locally). The worked [Training
business](../examples/training-business/.blueprint/v2.8/) example is a separate model.
