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
npx @archally/blueprint-schema blueprint-check .blueprint/v2.8
npm run check:examples                  # ecommerce example
npx @archally/blueprint-schema blueprint-check --list
npx @archally/blueprint-schema blueprint-check <dir> --config .blueprint-lint.yaml
```

## Rules (`rules/*.yaml`)

| Rule ID | Default | What it requires |
|---------|---------|------------------|
| `orphan-entities` | warn | every entity (except Missing/CodeFile) referenced by ≥ 1 relation |
| `org-interaction-diverges-from-architecture` | warn | every `interacts_with` of nature `architectural` matches a dependency the architecture states |
| `org-interaction-underived` | info | a unit that lists its architectural dependencies lists all the ones the architecture shows |
| `org-interaction-unverifiable` | info | reports where that comparison could not be made, so an unwalkable chain does not read as agreement |
| `missing-causal-links` | warn | every command Operation has a `produces` edge to an event |
| `missing-exchange-binding` | warn | every command/query Operation declares an `exchange` (transport binding); events exempt |
| `contract-operation-missing-exchange` | warn | every Operation wired to a service contract (`expose`/`call`/`send`/`receive`) declares an `exchange` |
| `contract-operation-missing-channel-address` | warn | every Operation wired into a contract's `send`/`receive` list names a channel - `exchange.topic.name` or `exchange.queue.name`; one that declares no `exchange` at all is left to the rule above |
| `event-transport-without-contract` | warn | an event whose `exchange` names a messaging protocol and a channel is listed under some service contract's `send` or `receive`, so the architecture says who publishes it and who is entitled to hear it. The reverse direction of the two `contract-operation-*` rules above: those start from the contract and ask about the transport, this one starts from the transport and asks about the contract |
| `exchange-missing-payload` | warn | every Operation with an `exchange` also declares a `payload.schema` (the data model on the wire) |
| `events-with-produces` | warn | no event Operation is the source of a `produces` edge (anti-pattern) |
| `untested-rules` | warn | every business rule has an incoming `validated-by` edge (a test validates it) |
| `activity-steps-reverse-causal-edge` | warn |
| `activity-steps-without-causal-edge` | info |
| `activity-without-entry-operation` | warn | every story activity names the `entry_operation` it begins with; an activity may omit it while the operation is not yet modelled, and this reports the gap |
| `aggregate-root-signals` | info | aggregate-root Concepts have lifecycle states or relationships |
| `unanswered-questions` | info | every Question has an outgoing `answered-by` edge |
| `dispatch-with-exchange` | warn | no Operation sets `dispatch: in-process` *and* an `exchange` — they are mutually exclusive |
| `empty-context` | warn | a Context that declares services handles at least one operation (an incoming `handled_by`); a context with no services is a named boundary and is out of scope |
| `unbound-operation` | warn | every Operation is provided by some bounded context (a contract `expose`/`send`, or the deprecated name/scope fallback) |
| `unbound-question` | warn | every competency Question resolves to a bounded context |
| `leverage-point-no-address` | warn | every LeveragePoint addresses at least one finding, risk or decision |
| `leverage-point-no-strategic-intent` | info | every LeveragePoint links to a goal or value stream |
| `undescribed-event` | warn | every event Operation carries prose (`description` \| `statement` \| `summary`) — catches the asymmetric `one_of` pair, where only the happy-path half is described |
| `decision-asserted-without-evidence` | warn | every Decision marked `certainty: confirmed` cites `evidence[]` — an evidentiary claim with no source. Speculative/probable decisions are exempt by design |
| `user-story-use-case-back-reference` | warn |
| `user-story-without-acceptance-criteria` | info | every UserStory has `acceptance_criteria` — without them nothing can be derived into a test case |
| `model-without-purpose` | info | every model declares its CQRS `purpose` (`command-payload` \| `event-payload` \| `read-model` \| `shared` \| `dto`) |
| `model-without-represents` | info | every model maps to the concept(s) it carries via `represents[]`; omit only for envelopes/wrappers |
| `payload-model-unbound` | info | every payload model (`command-payload` \| `event-payload` \| `read-model`) is referenced by some Operation's `payload:`; `shared`/`dto` are exempt, being referenced by models rather than operations |
| `payload-schema-unresolved` | warn | every Operation's `payload.schema` resolves to a model component that exists - a reference naming nothing becomes a `Missing` placeholder, which no other rule reports; the sibling `payload-model-unbound` asks the reverse question, whether an authored model is referenced at all |
| `story-without-event` | info | every Story names at least one event among its operations, or names a command that `produces` one - a story whose steps neither are nor produce an event states an intent with no observable outcome; info because a read-only journey is a legitimate story |
| `service-without-system` | warn | every Service is placed in a system: nested under a party by position, or under a root-declared context that names `system_ref` (or inherits the document's `system_ref` default). A service with neither renders in no system's box, and the context it belongs to spans one system fewer than it should; advisory because silence is not contradiction - a `system_ref` naming a party nothing declares is reported as an error instead |
| `service-system-is-an-organization` | warn | a Service's `system_ref` names a party of kind `system`, never `organization` - a component belongs to a technical system, while a business unit or company owns it, which is what `owned_by` states. A party that declares no `kind` is not reported |
| `party-parts-disagree` | warn | two declarations of one party do not contradict each other. A party is one node however many documents declare it; the parts are unioned, and a scalar that two of them define differently keeps the first value, so the disagreement is reported rather than resolved. Declare the party whole once and let the other documents name it through `system_ref` |
| `environment-named-not-declared` | warn | a server's `environment` names an environment the model declares. A name from the common vocabulary or an `x-` prefixed name resolves to nothing, so nothing else can notice that the model holds two vocabularies for one set of environments; only the typed id (`ENV###`) is a reference. Silent in a model that declares no environments at all |
| `environment-config-key-not-declared` | warn | per-environment configuration on a resource is keyed by an environment the model declares. The literal `ALL` means every environment rather than naming one and is never reported; a key in the typed form naming no declared environment is a cross-reference error from validation instead, because that form is a reference and a dangling reference is a contradiction rather than a silence |

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
| `<path>` | blueprint directory (positional; default `.blueprint/v2.8`) |
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
