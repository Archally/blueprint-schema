# Tools and Archally Pro

Run the reference tools from a clone of Archally Blueprint Schema. The validator is plain
JavaScript and carries the schemas with it. It runs after `npm install`. The model builder and
semantic checker are TypeScript and need `npm run build`.

| Tool | Use |
| --- | --- |
| [Validator](#validator) | Validate schema conformance, references, and gaps. |
| [Model builder](#model-builder) | Load a typed model graph in memory or write `model.json`. |
| [Semantic checker](#semantic-checker) | Check structural and semantic rules. |
| [Schema Atlas](#schema-atlas) | Generate a human-readable reference from the JSON Schema. |
| [Blueprint Handoff Atlas](#blueprint-handoff-atlas) | Generate PDFs for plain-language knowledge capture. |

See the [reference tools index](../tools/README.md) for the rest of the tools and the
[licence table](../README.md#license) for the terms.

## Validator

The validator uses Ajv (draft-2020-12) to check schema conformance. It also checks cross-file
reference integrity and reports gap warnings.

```bash
npm run validate -- .blueprint/v2.8
```

See the [validator reference](../tools/validator/README.md) for options and exit codes.

## Model builder

The model builder loads blueprint YAML into a typed in-memory graph with 55 entity types and
43 relation types. Use it as a library or run the CLI to write `model.json`.

```bash
# CLI - produce model.json
node tools/model-builder/dist/cli.js .blueprint/v2.8 --output model.json --pretty

# Library - import in TypeScript, from a workspace or a `file:` dependency on this clone
import { buildBlueprintModel, loadFromDirectory } from '@archally/blueprint-schema/model';
```

See the [model builder reference](../tools/model-builder/README.md) for the API, type
definitions, and architecture.

## Semantic checker

The semantic checker flags modeling issues outside schema validation. Configure rules in
`.blueprint-lint.yaml` or add your own `RuleDefinition` functions.

```bash
npm run check -- .blueprint/v2.8
```

See the [semantic checker reference](../tools/semantic-checker/README.md) for rule details,
configuration, and the custom rule API.

### Built-in rules

<!-- BEGIN GENERATED: semantic-rules - generated from the rule pack; do not hand-edit -->
Ships with **116 built-in rules** (7 error, 77 warn, 32 info):

`activity-fork-without-gateway` · `activity-in-two-lanes` · `activity-item-key-repeated` · `activity-steps-reverse-causal-edge` · `activity-steps-without-causal-edge` · `activity-tool-party-not-system` · `aggregate-root-signals` · `anemic-event-candidate` · `assumption-unplaced` · `broker-ref-target-not-a-broker` · `capability-kind` · `capability-nested-deeper-than-two-levels` · `capability-realized-nowhere` · `contract-broker-id-superseded` · `contract-operation-missing-channel-address` · `contract-operation-missing-exchange` · `dangling-relation-endpoint` · `decision-asserted-without-evidence` · `decision-option-without-pros-cons` · `dependency-direction-disagreement` · `dispatch-with-exchange` · `empty-context` · `environment-config-key-not-declared` · `environment-named-not-declared` · `event-placed-with-producer-capability` · `event-transport-without-contract` · `events-with-produces` · `evidence-source-credentials` · `exchange-missing-payload` · `feature-user-stories-exclusive` · `feature-user-stories-mismatch` · `fitness-function-unattached` · `gate-on-fail-not-a-successor` · `gateway-without-route` · `goal-not-advanced` · `goal-requires-cycle` · `governed-command-without-event` · `hotspot-statement-empty` · `implementation-as-is-without-code-refs` · `implementation-to-be-with-code-refs` · `imports-cycle` · `imports-target-not-library` · `inprocess-consume-without-provide` · `inprocess-dispatch-without-provider` · `inprocess-provide-without-consume` · `inprocess-reaction-unreached` · `inquiry-passed-on-without-addressee` · `inquiry-pin-ambiguous` · `inquiry-pin-named-twice` · `inquiry-pins-itself` · `kpi-without-metric` · `lane-team-differs-from-staffing` · `leverage-point-migration-back-reference` · `leverage-point-no-address` · `leverage-point-no-strategic-intent` · `link-provenance-correspondence` · `message-channel-mismatch` · `message-queue-unread` · `messaging-command-receiver` · `migration-dependency-reason-unlisted` · `migration-reach-disagrees` · `migration-without-team-owner` · `missing-causal-links` · `missing-exchange-binding` · `model-without-purpose` · `model-without-represents` · `nav-via-action-screen-disagrees` · `objective-without-measurement` · `operation-exposed-by-many` · `operation-outside-every-contract` · `operation-realizes-two-capabilities` · `operation-supersedes-cycle` · `org-interaction-diverges-from-architecture` · `org-interaction-underived` · `org-interaction-unverifiable` · `orphan-entities` · `owner-name-matches-declared-unit` · `party-parts-disagree` · `payload-model-unbound` · `payload-schema-unresolved` · `process-end-state-unattached` · `process-end-state-unreachable` · `process-listed-order-against-causality` · `process-starts` · `requirement-confirmed-without-evidence` · `requirement-unverified` · `requirement-without-objective` · `restated-coupling` · `routes-restates-uses` · `routes-target-is-library` · `sent-event-without-receiver` · `service-system-is-an-organization` · `service-without-system` · `shared-document-read-without-writer` · `shared-document-write-without-reader` · `shared-store-without-common-resource` · `slo-without-metric` · `story-without-event` · `test-case-act-not-validated` · `test-case-given-carries-notes` · `translation-target-not-internal` · `unanswered-questions` · `unbound-operation` · `unbound-question` · `undeclared-exchange` · `undescribed-event` · `unevidenced-dependency` · `untested-rules` · `use-case-step-action-operation-disagrees` · `use-case-step-action-screen-disagrees` · `use-case-step-order` · `user-story-use-case-back-reference` · `user-story-without-acceptance-criteria` · `uses-restates-contract` · `uses-target-is-library` · `work-activity-without-lane`
<!-- END GENERATED: semantic-rules -->

## Schema Atlas

The [Blueprint Schema Atlas](schema-atlas/) is a regenerable projection of the JSON Schema.
It includes a layer map, entity catalog, relationships, examples, and a structural changelog.
Every page includes provenance.

```bash
npm run atlas          # regenerate docs/schema-atlas/**
npm run atlas:check    # drift check (CI-friendly)
```

See the [Schema Atlas generator reference](../tools/schema-atlas/README.md) for the overlay
contract, fail/warn/skip policy, and governance.

## Blueprint Handoff Atlas

Use these non-technical guides to capture Blueprint knowledge in plain language before
transforming it into YAML.

```bash
npm run guides:pdf      # regenerate docs/handoff-guides/pdf/**
npm run guides:check    # drift check for committed PDFs
```

Start with the [umbrella guide](handoff-guides/markdown/README.md), open the
[umbrella PDF](handoff-guides/pdf/blueprint-handoff-atlas.pdf), or browse the
[full PDF directory](handoff-guides/pdf/).

## Archally Pro

Archally Blueprint Schema is the open foundation of the [Archally platform](https://archally.pro).
[Archally Pro](https://archally.pro) offers commercial tools that use the same model. Its
renderers run locally on an offline licence under separate commercial terms.

| Archally Pro capability | What it does |
| --- | --- |
| Change Impact Analysis | See which services, resources, contracts, and tests a proposed change touches directly and transitively, and which teams must coordinate. Use `bp impact` on the CLI or `get_impact_report` over MCP. |
| Blueprint MCP Server | Gives Claude, Cursor, and other agents deterministic graph queries against a validated domain model at inference time. Supports entity and relation queries, subgraphs, neighbours, layer views, impact reports, typed ID allocation, and live validation. |
| Blueprint CLI (`bp`) | Query, mutate, validate, and migrate models from the terminal. Run semantic, quality, and coverage checks, allocate typed IDs, and track migrations with dry-run, rollback, variant comparison, and dependency resolution. |
| Interactive viewers | Architecture Viewer offers multiple graph layouts, search, layer filtering, and a relation inspector. Blueprint Studio offers read-only project navigation, migration-chapter scrubbing, and a validation dock. |
| Deterministic renderers | Generate a roadmap Gantt, leverage map, risk map, infrastructure map, topic impact dossier, API-contract tree, or test-case coverage PDF. The same canonical model produces reproducible artifacts. |
| Specification generators | Generate OpenAPI 3.1, AsyncAPI 2.6, Arazzo 1.0, OpenRPC, Pact, and Mermaid from blueprint operations, models, and contracts. |
| PRD and documentation | Generate Product Requirements Documents, Event Storming boards at big-picture, process, and software-design levels, and architecture decision exports from the governance and story layers. |
| Confluence Mirror | Publish model-derived pages to Atlassian Confluence so non-technical stakeholders read from the same source. |
