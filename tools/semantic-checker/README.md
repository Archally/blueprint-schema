# Blueprint Semantic Checker

Catches modeling issues schema validation cannot detect — orphan entities, missing causal links,
untested rules, domain gaps. As of v2.7.x the **engine is external**: this directory is a thin
blueprint-specific layer over [`@archally/semantic-checker`](https://github.com/archally/semantic-checker):

```
loadFromDirectory ─▶ buildBlueprintModel ─▶ toCheckableModel (adapter) ─▶ @archally/semantic-checker
   (parse YAML)          (entities+relations)        (normalize)             (loadRules → runChecker)
```

The rules are declarative YAML (`rules/*.yaml`) — the table below is the inventory, and it is
machine-checked against those files, so it cannot drift. The engine, severity handling, and JSON-Schema
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
| `missing-exchange-binding` | warn | every command/query Operation declares an `exchange` (transport binding); events exempt |
| `contract-operation-missing-exchange` | warn | every Operation wired to a service contract (`expose`/`call`/`send`/`receive`) declares an `exchange` |
| `exchange-missing-payload` | warn | every Operation with an `exchange` also declares a `payload.schema` (the data model on the wire) |
| `events-with-produces` | warn | no event Operation is the source of a `produces` edge (anti-pattern) |
| `untested-rules` | warn | every business rule has an incoming `validated-by` edge (a test validates it) |
| `aggregate-root-signals` | info | aggregate-root Concepts have lifecycle states or relationships |
| `unanswered-questions` | info | every Question has an outgoing `answered-by` edge |
| `dispatch-with-exchange` | warn | no Operation sets `dispatch: in-process` *and* an `exchange` — they are mutually exclusive |
| `unbound-operation` | warn | every Operation is provided by some bounded context (a contract `expose`/`send`, or the deprecated name/scope fallback) |
| `unbound-question` | warn | every competency Question resolves to a bounded context |
| `leverage-point-no-address` | warn | every LeveragePoint addresses at least one finding, risk or decision |
| `leverage-point-no-strategic-intent` | info | every LeveragePoint links to a goal or value stream |
| `undescribed-event` | warn | every event Operation carries prose (`description` \| `statement` \| `summary`) — catches the asymmetric `one_of` pair, where only the happy-path half is described |
| `decision-asserted-without-evidence` | warn | every Decision marked `certainty: confirmed` cites `evidence[]` — an evidentiary claim with no source. Speculative/probable decisions are exempt by design |
| `user-story-without-acceptance-criteria` | info | every UserStory has `acceptance_criteria` — without them nothing can be derived into a test case |
| `model-without-purpose` | info | every model declares its CQRS `purpose` (`command-payload` \| `event-payload` \| `read-model` \| `shared` \| `dto`) |
| `model-without-represents` | info | every model maps to the concept(s) it carries via `represents[]`; omit only for envelopes/wrappers |
| `payload-model-unbound` | info | every payload model (`command-payload` \| `event-payload` \| `read-model`) is referenced by some Operation's `payload:`; `shared`/`dto` are exempt, being referenced by models rather than operations |
| `payload-schema-unresolved` | warn | every Operation's `payload.schema` resolves to a model component that exists - a reference naming nothing becomes a `Missing` placeholder, which no other rule reports; the sibling `payload-model-unbound` asks the reverse question, whether an authored model is referenced at all |

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
| `rules/*.yaml` | the declarative rule packs the CLI loads (inventory: the Rules table above) |
| `adapter.test.ts` | adapter unit test (field mapping, plane derivation, relation renames) |

## Custom rules

Add a YAML rule pack under `rules/`, or for logic the DSL can't express, use the engine's
TypeScript escape hatch (`check.custom`) — see the package's `docs/extension-rules.md`.
