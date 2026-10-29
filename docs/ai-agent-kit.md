# AI agent kit

The repository carries a blueprint-modeling kit for AI coding agents: a `blueprint-modeler` agent,
fifteen method skills (domain discovery, DDD, Event Storming, SBVR business rules, capability
mapping, schema gotchas and more) and two commands, `/blueprint-new` and `/blueprint-check-all`.
It needs no Archally CLI and no MCP server. Validation is deterministic and local: the agent runs
this repository's own validator, semantic checker and quality gate.

## Prepare the clone

Node 20 or later. Once, in the repository root:

```bash
npm install
npm run build
```

The validator and the quality gate run after the install; the semantic checker and the other tools
run the compiled output that the build produces. Inside this repository the agent needs no
configuration: it recognizes the repository root as the schema root.

## How each host finds the kit

- **Claude Code** reads [`CLAUDE.md`](../CLAUDE.md), which imports [`AGENTS.md`](../AGENTS.md), and
  finds the agent, commands and skills in `.claude/`.
- **Codex** reads `AGENTS.md` and the skills in `.agents/skills/`. The custom agent in <!-- public-docs-scan:allow Codex and Cursor read this path -->
  `.codex/agents/` loads once you trust the project; otherwise `AGENTS.md` tells Codex which file to <!-- public-docs-scan:allow Codex and Cursor read this path -->
  follow. Commands are plain files in `.agents/commands/`. <!-- public-docs-scan:allow Codex and Cursor read this path -->
- **Cursor** reads `AGENTS.md`, the skills in `.agents/skills/`, and the agent and commands in <!-- public-docs-scan:allow Codex and Cursor read this path -->
  `.cursor/`. <!-- public-docs-scan:allow Codex and Cursor read this path -->

Each host reads these files from the folder you open as the project, so open the repository folder
itself, not a folder above it.

## Quick start

The examples check the worked PrestaShop model in `examples/prestashop/.blueprint/v2.8`.

### Claude Code

1. Open a terminal in the repository folder and run `claude`.
2. Type `/blueprint-check-all examples/prestashop/.blueprint/v2.8`.
3. Claude Code asks permission for three `npm run` commands (`validate`, `check`, `quality`).
   Approve each one. The command reports the result of each check and, where a check finds
   something, proposes the fix.

### Codex

1. Open a terminal in the repository folder and run `codex`.
2. When Codex asks whether to trust the folder, trust it. The `blueprint-modeler` custom agent loads
   only in a trusted project.
3. Ask: `Run /blueprint-check-all on examples/prestashop/.blueprint/v2.8`. Codex reads the command
   file in `.agents/commands/` and runs the same three checks. <!-- public-docs-scan:allow Codex and Cursor read this path -->

### Cursor

1. Choose **File > Open Folder** and open the repository folder itself as the workspace. Cursor
   reads `.cursor/` only from the folder opened as the workspace root, so a parent folder shows no <!-- public-docs-scan:allow Codex and Cursor read this path -->
   commands.
2. In Agent chat, type `/`. Both `/blueprint-check-all` and `/blueprint-new` are listed.
3. Run `/blueprint-check-all examples/prestashop/.blueprint/v2.8` and approve the three commands
   when Cursor asks.

## Check that it works

- **Without an agent.** The three checks the command runs can be run by hand; each exits 0 on the
  example model:

  ```bash
  npm run validate -- examples/prestashop/.blueprint/v2.8 --schemas schema
  npm run check -- examples/prestashop/.blueprint/v2.8
  npm run quality -- examples/prestashop/.blueprint/v2.8
  ```

  The validator ends with `PASSED`.
- **With an agent.** Ask it which subagents, skills and commands the project provides. The answer
  names the `blueprint-modeler` agent, the fifteen skills listed in [`AGENTS.md`](../AGENTS.md) and
  the two commands. In Claude Code and Cursor, typing `/` lists both commands.

## Use the kit in another project

Copy `.agents/`, `.claude/`, `.codex/`, `.cursor/`, `AGENTS.md` and `CLAUDE.md` into that project's <!-- public-docs-scan:allow Codex and Cursor read this path -->
root (merge the two files into existing ones rather than replacing them), and set
`BLUEPRINT_SCHEMA_ROOT` to your clone of this repository, for example
`export BLUEPRINT_SCHEMA_ROOT=~/src/blueprint-schema`. The agent and the commands read the schema
and run the validator from there.

## License

The kit is licensed under the Apache License, Version 2.0, Copyright 2026 Adam Walkowski. See
[LICENSE](../LICENSE).
