# Blueprint Semantic Checker

Catches modeling issues schema validation cannot detect — orphan entities, missing causal links,
untested rules, domain gaps. As of v2.7.x the **engine is external**: this directory is a thin
blueprint-specific layer over [`@archally/semantic-checker`](https://github.com/archally/semantic-checker):

```
loadFromDirectory ─▶ buildBlueprintModel ─▶ toCheckableModel (adapter) ─▶ @archally/semantic-checker
   (parse YAML)          (entities+relations)        (normalize)             (loadRules → runChecker)
```

The six rules are declarative YAML (`rules/*.yaml`); the engine, severity handling, and JSON-Schema
rule validation come from the package. See its
[`docs/`](https://github.com/archally/semantic-checker/tree/main/docs) for the rule DSL.

## Usage

```bash
npx @archally/blueprint-schema blueprint-check .blueprint/v2.7
npm run check:examples                  # ecommerce example
npx @archally/blueprint-schema blueprint-check --list
npx @archally/blueprint-schema blueprint-check <dir> --config .blueprint-lint.yaml
```

## Rules (`rules/*.yaml`)

| Rule ID | Default | What it requires |
|---------|---------|------------------|
| `orphan-entities` | warn | every entity (except Missing/CodeFile) referenced by ≥ 1 relation |
| `missing-causal-links` | warn | every command Operation has a `produces` edge to an event |
| `events-with-produces` | warn | no event Operation is the source of a `produces` edge (anti-pattern) |
| `untested-rules` | warn | every business rule has an incoming `validated-by` edge (a test validates it) |
| `aggregate-root-signals` | info | aggregate-root Concepts have lifecycle states or relationships |
| `unanswered-questions` | info | every Question has an outgoing `answered-by` edge |

The adapter maps `BlueprintModel → CheckableModel` (`term`→`name`, plane derived from the layer
prefix, `validates`→`validated-by`, `question_answered_by`→`answered-by`). Output is now ordered
deterministically by `(rule, id)`; the set of findings on the example models is unchanged.

## Configuration

`.blueprint-lint.yaml` (same `{ rules: { <id>: severity } }` shape; consumed directly as the
engine's `CheckerConfig`):

```yaml
rules:
  orphan-entities: warn
  missing-causal-links: error
  aggregate-root-signals: off
```

Severities: `error` (fails), `warn`, `info`, `off`.

## CLI Options & Exit Codes

| Flag | Description |
|------|-------------|
| `<path>` | blueprint directory (positional; default `.blueprint/v2.7`) |
| `--config`, `-c` | path to `.blueprint-lint.yaml` (auto-detected in cwd otherwise) |
| `--list` | list available rules and exit |
| `--help`, `-h` | show help |

| Code | Meaning |
|------|---------|
| 0 | passed (warnings/info may be present) |
| 1 | failed (≥ 1 error-severity issue) |
| 2 | runner error (missing directory, invalid config) |

## Layout

| File | Responsibility |
|------|----------------|
| `cli.ts` | thin entry point — load model, adapt, run, format (compiled to `dist/cli.js`) |
| `adapter.ts` | `BlueprintModel` → engine `CheckableModel` |
| `rules/*.yaml` | the six declarative rule packs the CLI loads |
| `adapter.test.ts` | adapter unit test (field mapping, plane derivation, relation renames) |

## Custom rules

Add a YAML rule pack under `rules/`, or for logic the DSL can't express, use the engine's
TypeScript escape hatch (`check.custom`) — see the package's `docs/extension-rules.md`.
