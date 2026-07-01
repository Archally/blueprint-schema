# model-query

Deterministic **reuse-audit query** over a `model.json` produced by the [`model-builder`](../model-builder) tool.
Reads the merged model and reports the de-duplication / reuse graph — recurring finding themes, orphan risks,
shared-tactic decisions, duplicate actor archetypes, and shared-kernel concepts — so overlapping or duplicated design
across slices is easy to spot.

It is a **read-only consumer of the built model artifact**: it never reads the `.blueprint/` YAML or the filesystem
beyond the one `model.json` you point it at, and it bakes in **no project-specific data** (only generic
architecture-smell keyword heuristics).

## Usage

```
node tools/model-query/src/cli.mjs [model.json] [section]
```

- `model.json` — path to a model built by `model-builder` (default: `./model.json`).
- `section` — one of `findings | clusters | risks | decisions | actors | concepts | all` (default: `all`).

### Pipeline

```
model-builder  →  <model-dir>/.audit/model.json  →  model-query reads it
```

Build the model first, then query it:

```
# 1. build the model artifact
node tools/model-builder/dist/cli.js <blueprint-dir> --output <blueprint-dir>/.audit/model.json --pretty

# 2. query it
node tools/model-query/src/cli.mjs <blueprint-dir>/.audit/model.json decisions
```

### Sections

| Section | Reports |
|---|---|
| `findings` | Findings grouped by slice, with refs + matched smell themes |
| `clusters` | Findings bucketed by recurring smell theme (cross-slice) |
| `risks` | Risks, flagging orphans (not referenced by any `decision.motivation_refs.risks`) |
| `decisions` | Decisions, flagging shared architectural tactics + whether they carry `code_refs` |
| `actors` | Actor archetypes grouped by normalized name (duplicate-actor detection) |
| `concepts` | Concepts sharing a term/displayId across more than one slice (shared kernel) |
| `all` | Every section above (default) |

## Notes

- Pure Node ESM, no build step and no dependencies (same shape as the `validator` tool).
- The smell/tactic keyword sets are generic heuristics; extend the `CLUSTERS` / `TACTIC` maps in `src/cli.mjs` to tune
  what themes are surfaced for a given model.
