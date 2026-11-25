# Archally Blueprint Schema

Archally Blueprint Schema is a domain-first YAML specification for digital systems.
It brings architecture knowledge scattered across code, documents, and workshops into one
validated, version-controlled model.

A blueprint connects what the system does, why it works that way, and what proves it.
Teams can trace rules, operations, and decisions in the same model and generate contracts,
diagrams, and other documents from it.

**Current version: 2.8.108** · [Changelog](CHANGELOG.md) · [v2.8 changes](changelog/v2.8.yaml)

[![version](https://img.shields.io/badge/version-2.8.108-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-Apache--2.0%20%2B%20FSL--1.1-blue)](./LICENSE)
[![CI](https://github.com/archally/blueprint-schema/actions/workflows/validate.yml/badge.svg)](https://github.com/archally/blueprint-schema/actions)

## Why

Architecture knowledge is scattered across wikis, slide decks, whiteboard photos and people's memory.
Before a change (splitting a service, adding a context, planning a migration) a team spends days
rebuilding context that should already be explicit, and the documents drift from the code within weeks.
The cost is not missing documentation; it is fragmented truth. A blueprint keeps that truth in one
model that tools can check. The full argument is in [docs/architecture.md](docs/architecture.md).

## Quick start

### 1. Prepare the repository

With Node 22 or later, clone the repository, install dependencies, and build the local tools.

```bash
git clone https://github.com/Archally/blueprint-schema.git
cd blueprint-schema
npm install
npm run build
```

### 2. Start with your own agent

Open the cloned repository itself in Claude Code, Codex, or Cursor. Create an empty project
directory from the repository root.

```bash
mkdir my-training-model
```

Give your agent this request.

```text
Run /blueprint-new my-training-model Training model.
Use blueprint-modeler to ask about the core flow before expanding the model.
```

The command creates and checks a seed under `my-training-model/.blueprint/v2.8/`.
It stops if the project already contains a model. The kit runs the repository's local checks.
It works without the Archally Pro CLI or an MCP server.

For host-specific instructions and the two-file YAML seed you can write yourself, see
[Model setup](docs/2026-11-25-model-setup.md). For a project outside the clone, see
[Use the kit in another project](docs/ai-agent-kit.md#use-the-kit-in-another-project).

### 3. Check locally

After expanding the model, ask your agent to run the checks.

```text
Run /blueprint-check-all my-training-model/.blueprint/v2.8
```

You can run the same checks from the prepared repository root.

```bash
npm run validate -- my-training-model/.blueprint/v2.8 --schemas schema
npm run check -- my-training-model/.blueprint/v2.8
npm run quality -- my-training-model/.blueprint/v2.8
```

| Check | What to review |
| --- | --- |
| Validate | Schema conformance and references. Confirm that `Schemas:` selects v2.8 and `Files:` reports the number of files validated. The two-file seed reports two. |
| Check | Structural and semantic findings. |
| Quality | Missing or weak descriptions and overall coverage. A small seed can pass validation while still needing detail. The default quality command can exit 0 while coverage is incomplete. |

Review the schema, semantic, and quality findings with your agent.

### Inspect the worked example

[Training business](examples/training-business/.blueprint/v2.8/) models a fictional business
that runs paid workshops online and in a room, records a video course, and offers subscription
access to it. Run the same three checks on `examples/training-business/.blueprint/v2.8` to
see a model that passes them.

## What goes in a blueprint?

| Layer | What it captures |
| --- | --- |
| Design Plane | Bounded contexts, aggregates, operations, rules, data models, stories, screens, and quality attributes. |
| Governance Plane | Goals, risks, decisions, test cases, capabilities, value streams, milestones, and ownership. |
| Metamodel | Typed IDs, versioning, and traceability across both planes. |

Blueprints are plain YAML files in your Git repository. You can validate locally, review in pull
requests, and keep your existing deployment workflow. Every schema field has a machine-readable
`description`.

| Read more | What you'll find |
| --- | --- |
| [Architecture](docs/architecture.md) | System cartography, the two planes, their entity types, and the schema file map. |
| [Modeling approaches](docs/2026-11-25-modeling-approaches.md) | Greenfield and brownfield workflows, modeling phases, knowledge gathering, and best practices. |
| [Schema reference](docs/schema-reference.md) | ID patterns, traceability, and schema evolution. |
| [Blueprint Schema Atlas](docs/schema-atlas/) | A generated layer map, entity catalog, relationship map, and structural changelog. |
| [Blueprint Handoff Atlas](docs/handoff-guides/markdown/README.md) | Plain-language capture guides for workshops and handoffs. |

## Tools

Run the reference tools from the clone. The validator runs after `npm install`. Build the model
builder and semantic checker with `npm run build`.

| Tool | What it does |
| --- | --- |
| [Validator](tools/validator/README.md) | Checks schema conformance, cross-file references, and gaps. |
| [Model builder](tools/model-builder/README.md) | Loads YAML into a typed graph or writes `model.json`. |
| [Semantic checker](tools/semantic-checker/README.md) | Runs configurable rules for modeling issues beyond schema validation. |
| [Quality gate](tools/quality-gate/) | Measures how well the model describes itself. |
| [Schema Atlas generator](tools/schema-atlas/README.md) | Builds and checks the human-readable reference from the schema. |
| [Guide publisher](tools/guide-publisher/) | Builds and checks PDFs for the Blueprint Handoff Atlas. |
| [AI agent kit](docs/ai-agent-kit.md) | Supplies a modeling agent, fifteen method skills, and two commands for Claude Code, Codex, and Cursor. |
| [VS Code setup](docs/2026-11-25-vs-code-setup.md) | Enables schema validation and file icons, including in a multi-root workspace. |

See [Tools and Archally Pro](docs/tools.md) for commands, the semantic rule catalog, and the
commercial tool capabilities.

### Archally Pro

[Archally Pro](https://archally.pro) offers a Blueprint CLI and MCP server, change impact
analysis, interactive viewers, deterministic renderers, specification and document generators,
and Confluence publishing. Archally Pro renderers run locally on an offline licence.

## More examples

| Model | Contents |
| --- | --- |
| [E-commerce](examples/ecommerce/) | A working example with three bounded contexts: catalog, orders, and payments. |
| [E-commerce v2.8](examples/ecommerce/.blueprint/v2.8/) | A larger, separate teaching model with migrations. |
| [dotnet/eShop v2.8](examples/eshop/.blueprint/v2.8/) | One order journey through dotnet/eShop. |

```bash
npm run validate:examples
npm run validate:ecommerce:v28
npm run validate:eshop:v28
npm run check:ecommerce:v28
npm run check:eshop:v28
```

The [e-commerce example guide](docs/2026-11-12-ecommerce-and-eshop-examples.md) lists all three.

## Versioning

Archally Blueprint Schema follows [SemVer](https://semver.org/).

| Change | Example | Scope |
| --- | --- | --- |
| Major | 3.0.0 | Breaking schema changes |
| Minor | 2.7.0 | New optional fields or entity types |
| Patch | 2.6.1 | Documentation, clarification, and validator fixes |

## Contributing

Issues and discussions are welcome. For a schema change, open an issue describing the use case
before submitting a pull request. Schema changes affect downstream consumers. Contributions
require a DCO sign-off (`git commit -s`) and follow the terms in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Copyright 2026 Adam Walkowski. The repository uses two licences. See the authoritative
[licence map](./LICENSE) for the complete list.

| Part | Licence | Terms |
| --- | --- | --- |
| Schema, examples, docs, Schema Atlas generator, reference validator, VS Code extension, AI agent kit | [Apache 2.0](./LICENSE-APACHE) | Allows commercial and proprietary use. The schema can be used independently of Archally tooling. |
| Source-available tools including `model-builder`, `semantic-checker`, `quality-gate`, `renderer`, and `schema-update` | [FSL-1.1-ALv2](./LICENSE-FSL) | Allows Permitted Purposes, including internal use, non-commercial education and research, and professional services. The terms restrict Competing Use. Each version converts to Apache 2.0 two years after release. |
| Archally Pro renderers | Separate commercial terms | Run locally on an offline licence. |

For a commercial licence covering a Competing Use, contact adam.walkowski@inperceptic.com.
"Archally" and "Blueprint" are trademarks. See [TRADEMARKS.md](./TRADEMARKS.md).
