# Blueprint Schema Changelog
# All schema version releases in reverse chronological order.
---
entries:
  - version: "2.7.11"
    date: "2026-08-24"
    summary: >
      An operation key is constrained to the identifier it was always meant to be. The
      `operations:` and `errors:` dictionaries in `design/domain.schema.yaml` gain
      `propertyNames` with the pattern `^[a-z][A-Za-z0-9]*$`: a key starts lowercase and
      carries only letters and digits.

      This is a NEW CONSTRAINT rather than a new field: a model holding a key with a space or a
      punctuation mark is invalid under 2.7.11 and the key has to be renamed, along with every
      `<slice>:<key>` reference to it. The key is an address, not a label: contract lists in `arch.yaml` name an operation as
      `<slice>:<key>`, so a key that cannot be written into a reference is a broken reference
      rather than a formatting preference, and nothing enforced it. Uniqueness needs no rule
      at either level, because YAML rejects a mapping with two identical keys before a
      validator sees the file.

      `name` stays deliberately unconstrained. It is prose for a reader and most names contain
      spaces; the two fields answer different questions. The key is also not required to be
      derived from `name`, and the descriptions of both fields are corrected in the same
      release to stop saying that it is. A key is free to shorten a long name
      (`exportEventIcs` for "Export Event As ICS"), so a tool that computes a key from a name
      will disagree with the model. Read the key from the model.

  - version: "2.7.10"
    date: "2026-08-24"
    summary: >
      A service can say which operations it handles in-process, asserting no transport:
      optional `handles:` operation-ref array on the service in `design/arch.schema.yaml`.
      Strictly additive and optional.

      An operation belongs to the bounded context(s) whose services provide it, and the other
      two ways to provide one both name a protocol: a contract's `expose:` or `send:`. An
      operation called in-process has no protocol, which left a model with a large in-process
      surface choosing between declaring a channel that does not exist, and which every
      generated diagram then draws as fact, or falling back on the deprecated domain-file
      name/scope heuristic, which is single-valued and so cannot express one operation handled
      in several contexts. `handles:` is the provider-side declaration for exactly that case.

      It is not `call:`, which points the other way: `call:` lists operations a service depends
      on, and binding a service to one would record the caller as the handler. `handles:` is
      declared on the service rather than under `contracts:`, because every key there names a
      protocol with a generated specification and this has neither. Services in different
      contexts may each declare the same operation, and each declaration is its own binding, so
      an operation genuinely handled in several places needs no winner. The `unbound-operation`
      check now names all three provider sources, and says plainly that an operation with no
      channel must never be given one to silence it.

  - version: "2.7.9"
    date: "2026-08-20"
    summary: >
      A bounded context can name the domain it belongs to. `design/arch.schema.yaml` gains an
      optional `domain_ref` on the context: a name from `layout.slices` in `blueprint.yaml`.
      Without it, a context belongs to the slice directory its `arch.yaml` sits in — which is
      positional, so moving a file moves the context, and a file at the model root belongs to no
      slice at all. Declaring `domain_ref` makes the assignment explicit and independent of
      location. A value naming a slice the model does not declare is an error rather than a new
      domain, so a typo cannot invent one. Strictly additive: a model that omits it is unaffected.

      Also published for the first time: `render.manifest.schema.yaml`, which describes a project's
      render manifest — the file declaring which artifacts to produce, where their output lands, and
      the single build stamp the whole run shares. Editor validation is wired the same way as any
      other schema here, with a `# yaml-language-server: $schema=` line at the top of the manifest.

      Three `output:` descriptions in `design/arch.schema.yaml` now state what the field actually
      identifies: a contract artifact's identity (`<name>`, `<slice>/<name>` or `_global/<name>`),
      not one service's copy of it. Two services declaring the same value contribute to one merged
      artifact, which the previous one-line description did not say.
  - version: "2.7.8"
    date: "2026-07-26"
    summary: >
      Model properties are now described by the schema. `design/models.schema.yaml` gains a
      `model_property` `$def`, referenced from `model_schema.properties`, covering the JSON Schema
      vocabulary models already use: `type` (a name or a union array), `description`, `title`,
      `format`, `nullable`, `example`, `examples`, `default`, `const`, `enum`, `items`, nested
      `properties`, `required`, `additionalProperties`, `$ref`, the numeric/string/array bounds,
      the `readOnly`/`writeOnly`/`deprecated` flags, and the `oneOf`/`anyOf`/`allOf`/`not`
      combinators (recursive).

      STRICTLY ADDITIVE — every field is optional and unknown keys are still allowed, so this
      release adds no new validation constraint and no existing model can start failing. Before it,
      `properties` was declared `{type: object}` with entirely unconstrained values, which meant
      editors, autocomplete and the schema-atlas had no property vocabulary to offer. The field
      shapes were chosen from a census of real models rather than from the JSON Schema spec alone —
      `example` in particular is left unconstrained because models legitimately use objects, arrays
      and null there, not only scalars.

      It is also the anchor a future release can attach a required `description` to: you cannot
      require a field on a shape that does not exist.

      Two further additions ship in this release. The **infrastructure resource-type profile
      catalog** (`schema/v2.7/profiles/**`) becomes available, giving `type_ref` a substrate-neutral
      vocabulary with per-substrate realizations. And **four tools** — `next-id`, `coverage-check`,
      `entity-query` and `doc-snippet-validate` — are published with their bins and npm scripts.
      Both are additive: no existing model or command changes behaviour.
    changes:
      - kind: add
        target: "schema/v2.7/design/models.schema.yaml"
        semver: minor
        notes: >
          New `$defs/model_property`; `model_schema.properties` now declares
          `additionalProperties: {$ref: "#/$defs/model_property"}`. All fields optional,
          `additionalProperties` open.
      - kind: add
        target: "schema/v2.7/profiles/infrastructure/**"
        semver: minor
        notes: >
          The infrastructure resource-type profile catalog, introduced alongside the v2.7.7
          infrastructure layer, is now available in this package.
          `profiles.schema.yaml` defines the profile shape. `neutral.yaml` declares 5
          abstract resource types with an inputs/outputs contract — RT001 `relational-database`,
          RT002 `object-store`, RT003 `message-queue`, RT004 `cache`, RT005 `secret-store` — and
          five substrate profiles realize them: `azure` (5, via Azure Verified Modules), `aws` (3),
          `k8s` (3), `on-prem` (3), `openstack` (2). RT001 is realized on ALL five with an
          IDENTICAL outputs contract; that identity is what makes a `type_ref` substrate-neutral,
          and it is the point of the catalog. Modules are referenced with version pins — vetted
          modules, never raw resources. Additive: nothing references a profile unless a model opts
          in via `type_ref`/`needs`, and RT### refs resolve against this catalog rather than the
          model, so validators skip them in cross-reference checks.
      - kind: add
        target: "tools/{next-id,coverage-check,entity-query,doc-snippet-validate}"
        semver: minor
        notes: >
          Four tools, published with `blueprint-next-id`, `blueprint-coverage-check` and
          `blueprint-entity-query` bins plus `npm run` scripts (`next-id`, `coverage-check`,
          `entity-query`, `doc-snippets`, `quality`). All are zero-build `.mjs` — no compile step
          and no runtime dependencies beyond Node.

  - version: "2.7.7"
    date: "2026-07-15"
    summary: >
      Infrastructure-layer maturation + first-class DeploymentScope (DSC###) + a motivation `vision`
      field. The infrastructure design layer (ex-`rg`, frozen since v2.0.0) now participates in the
      knowledge graph: typed resource ids (IR###), first-class Environments (ENV###), a resource-type
      catalog (RT###) and bindings (BND###), TOSCA inter-resource relations
      (hosted_on/connects_to/depends_on/attaches_to/routes_to), IaC traceability (iac_refs), and the
      abstract-need → binding → concrete-instance split. DeploymentScope adds a substrate-neutral
      management / lifecycle / ownership / billing partition (Azure RG·Subscription, AWS Account·OU,
      GCP Project·Folder, k8s Cluster·Namespace, on-prem Datacenter·host-pool) that is deliberately
      ORTHOGONAL to runtime placement — `scope_ref` groups by who owns/bills a resource, `hosted_on`
      says what it runs on, and they may legitimately disagree (an elastic-pool DB). All strictly
      additive; every prior model validates unchanged. Three coordinated CRs share this version.
    tasks:
      - "infrastructure-layer-v2.7.7 CR (graph participation, needs/bindings, cross-layer wiring)"
      - "infra deployment-scopes CR (DSC###, scope_ref, target_scope.ref, scope-tree)"
      - "motivation vision-field CR (governance north-star)"
    changes:
      - kind: add
        target: "metamodel.schema.yaml"
        semver: minor
        notes: >
          New typed-ID reference `$defs`: `infra_resource_ref` (IR###), `environment_ref` (ENV###),
          `resource_type_ref` (RT###), `binding_ref` (BND###), and `deployment_scope_ref` (DSC###) —
          each optionally context/environment-prefixed — plus the `infra_relation` TOSCA vocabulary
          (hosted_on/connects_to/depends_on/attaches_to/routes_to) and the shared `validates_links` /
          `impacts_links` template shapes. Prefixes are collision-free and pattern-distinct from their
          visual neighbours (ENV != EN, BND != BD, RT != R, DSC != a decision D###); RES### stays
          `resilience_ref` (the infra resource is IR###, not RES###). Typed IDs — including DSC### — are
          STRONGLY ENCOURAGED but OPTIONAL in v2.7.x (a free-string id stays schema-valid; the validator
          WARNs on a non-matching id) and become REQUIRED in v2.8. `schema_version` enum unchanged
          (keys off the `2.7.0` minor line).
      - kind: add
        target: "design/infrastructure.schema.yaml"
        semver: minor
        notes: >
          The infrastructure layer gains full graph participation: typed `resources[]` (IR###) with
          `platform`, `hosting_model`, `exposure`, `owner`, TOSCA `relations[]`, `iac_refs[]`, and
          per-environment config; first-class `environments[]` (ENV###); abstract `needs` (Score
          type/class/id/params) resolved per environment by `bindings[]` (BND###) to a concrete
          resource — the three altitudes need → binding → instance. NEW DeploymentScope surface:
          `deployment_scopes[]` (required id/name/kind; optional `parent`, `substrate`, `provider`,
          `owner`, `region`) building a subscription→resource-group tree; `resource.scope_ref` (DSC###)
          names a resource's managing scope; `environment.target_scope` accepts either the inline
          `{ kind, name }` or a first-class `{ ref: DSC### }`. `scope_kind` is a 14-value enum shared
          with `target_scope` (account/subscription/project/resource_group/region/availability_zone/
          cluster/namespace/datacenter/site/rack/host_pool/vlan/other). Strictly additive.
      - kind: add
        target: "design/arch.schema.yaml + design/quality.schema.yaml + governance/decisions.schema.yaml + governance/test-cases.schema.yaml"
        semver: minor
        notes: >
          Cross-layer wiring to the infrastructure graph (all additive/optional): arch services declare
          abstract `needs` and typed `resource_refs` (IR###) — making the service→infrastructure edge a
          first-class, traversable placement edge (the free-string `infrastructure` category list is
          soft-deprecated); quality SLOs / resilience requirements target IR###; decisions record
          `impacts` on IR###/ENV###; test cases record what infrastructure they `validate`. The legacy
          `rg`-era free-string shapes remain valid as deprecated fallbacks.
      - kind: add
        target: "governance/motivation.schema.yaml"
        semver: minor
        notes: >
          New optional singular `vision` object on the motivation document: a required `statement` plus
          optional `aspiration`, `advances_goals` (G###), `capability_refs` (CAP###), `value_stream_refs`
          (VS###), and the standard epistemic fields. Gives the product's identity claim / north-star a
          first-class home distinct from `goals` (measurable objectives) and the root `description`.
          Purely additive — existing motivation files stay valid (vision is optional, at most one).
      - kind: add
        target: "tools/validator"
        semver: patch
        notes: >
          The validator mirrors the DeploymentScope posture: a DSC### typed-id WARN (free-string id valid
          but discouraged), dangling `scope_ref` / `target_scope.ref` / `parent` as Cross-Reference
          Errors, and a `parent`-chain cycle as a schema-level ERROR (a subscription→resource-group
          hierarchy must be a tree). `scope_ref`/`target_scope.ref` resolvability rides the generic
          cross-ref walk; the scope-graph checks are new.
      - kind: add
        target: "examples/deployment-scopes"
        semver: patch
        notes: >
          New minimal example — an Azure-style subscription with two resource-groups, showing the
          keystone `scope_ref`-vs-`hosted_on` distinction (the Accounting DB is managed by the
          Accounting RG yet hosted on the Shared SQL pool) and `environment.target_scope: { ref }`.
          Validates clean.
  - version: "2.7.6"
    date: "2026-07-09"
    summary: "Arch hierarchy typed IDs (BC###/SVC###, reusing PRT### for parties) + context-ownership binding — operations bind to bounded contexts via arch service contracts (expose/send), questions via an explicit bounded_context_ref. (The infrastructure-layer changes originally slated to append here were split out to a standalone v2.7.7 — IR/ENV/RT/BND did NOT ship in 2.7.6.)"
    changes:
      - kind: add
        target: "metamodel.schema.yaml"
        semver: minor
        notes: >
          (Additive/optional.) New typed-ID reference $defs: `bounded_context_ref` — canonical BC###
          (arch bounded-context id, optionally context/party-prefixed) with a deprecated legacy
          kebab-context-name compatibility shim (anyOf) for the migration window — and `service_ref`
          (SVC###). `party_ref` (PRT###) already existed and is reused for arch parties (no new $def).
          Resolvability of bounded_context_ref is WARN-not-enforce in 2.7.6 (an operation resolving to 0
          contexts, or a ref to an unknown BC###, warns; promoted to error a version later).
          schema_version enum unchanged (keys off the 2.7.0 minor line).
      - kind: add
        target: "design/arch.schema.yaml"
        semver: minor
        notes: >
          Arch hierarchy gains typed ids — `party.id` (PRT###, reconciles to the org-layer party),
          `context.id` (BC###), `service.id` (SVC###) — added inline on the nested
          party→context→service objects (hierarchy preserved, not flattened).
          `dependency.bounded_context_ref` (BC###) adds id-based inter-context edges (the name string
          becomes a deprecated fallback). Operation→bounded-context membership is DERIVED from arch
          service contracts (`expose`/`send` = handled/produced, many-to-many) — there is NO
          bounded_context_ref on domain files (the contract already states where an operation is
          handled). The legacy file-level name/scope match stays as a deprecated fallback. Arch ids are
          STRONGLY ENCOURAGED and OPTIONAL in v2.7.x; REQUIRED in v2.8 (with the resolvability warn→error
          promotion). Additive — every existing model validates unchanged (prestashop: PASSED,
          0 schema errors).
      - kind: add
        target: "design/domain.schema.yaml"
        semver: minor
        notes: >
          The `question` object gains an optional, SINGLE-VALUED `bounded_context_ref` (BC###,
          scope-prefixed; kebab-name shim) — the bounded context whose knowledge boundary a competency
          question defines. Explicit and single-owner (arch references questions nowhere), especially
          load-bearing for UNANSWERED questions (empty answered_by) which have no operations to inherit a
          BC from yet still belong to the BC carrying the knowledge gap. Explicit-primary; deprecated
          name/scope fallback; an op-less, ref-less question resolves to 0 contexts → resolvability WARN.
          Concepts are NOT given this field (genuinely m:n). Encouraged/optional in v2.7.x, required in
          v2.8. Additive.
  - version: "2.7.5"
    date: "2026-07-07"
    summary: "Tracker link registry — root `trackers`/`default_tracker` + `tracker_config` $def, so a `tracker_ref` (roadmap work-items, milestones, blockers) resolves to a clickable Jira/Confluence link"
    changes:
      - kind: add
        target: "blueprint.schema.yaml"
        semver: minor
        notes: >
          (Additive/optional.) New root `trackers` map (tracker id → `tracker_config` = {url template,
          optional label}) plus `default_tracker`, and a new `tracker_config` $def. A `tracker_ref` of
          the form `<tracker>:<key>` (e.g. `jira:ABC-1`, `confluence:12345`) resolves to a clickable link
          via the tracker's URL template (`{key}` substituted, or appended when the template has no
          `{key}`); a bare key resolves via `default_tracker`; a ref that is already a full URL is used
          verbatim. Lets one blueprint link into multiple Jira sites/projects and Confluence spaces while
          storing only short keys. No metamodel/schemaVersion change (the enum keys off the minor line
          `2.7.0`); backward-compatible. Schema shipped in commit 95d911d; this entry + the package.json
          bump (2.7.4→2.7.5) reconcile the version stamps that commit omitted.
  - version: "2.7.4"
    date: "2026-07-05"
    summary: "Governance-plane enrichment — leverage-point layer (LP###), evidence/provenance on test cases, and ISO/IEC 25010:2011 two-level quality characteristics on findings"
    changes:
      - kind: add
        target: "governance/leverage.schema.yaml"
        semver: minor
        notes: >
          New Leverage Map governance layer: `LeveragePoint` (LP###) — a prioritization tier ABOVE the
          finding→risk→decision→migration chain — plus `watch_item` (W###), and document arrays
          `leverage_points`/`pareto_core`/`ranking_basis`/`watchlist`. Typed relations
          (finding/risk/decision/fitness-function refs = AS-IS; migration_refs/realized_by→WI### = TO-BE;
          advances_goals/value_streams/capability_refs = strategic; depends_on/enables→LP### = graph).
          Additive/optional.
      - kind: modify
        target: "governance/test-cases.schema.yaml"
        semver: minor
        notes: >
          Optional `provenance` (evidence + discovery-stage + certainty) on `test_case` and
          `fitness_function` — orthogonal to `code_refs` (code_refs = automation; provenance = manual /
          documentation / assumption). Additive/optional.
      - kind: modify
        target: "metamodel.schema.yaml"
        semver: minor
        notes: >
          Added `leverage_ref` (LP### pattern). Added `$defs/quality_characteristic` (ISO/IEC 25010:2011
          top-level 8 + `safety`) and `$defs/quality_subcharacteristic` (the ISO 25010 sub-characteristics,
          incl. 2023 safety) for reuse. Additive.
      - kind: modify
        target: "design/quality.schema.yaml"
        semver: major
        notes: >
          `finding.quality_characteristic` now $refs the ISO 25010:2011 top-level enum (was the
          maintainability-family mix `[maintainability, modularity, analysability, testability,
          reusability]`). Added optional `quality_subcharacteristic` (finer grain) and `regulatory[]`
          (GDPR/PCI-DSS/WCAG tag — NOT a 'compliance' characteristic). Generalized `severity.description`.
          BREAKING: `modularity/analysability/reusability/testability` are no longer valid top-level
          values (they are now sub-characteristics) — remap external v2.6 data via schema-update module 002.
      - kind: modify
        target: "blueprint.schema.yaml"
        semver: minor
        notes: >
          Wired the governance `leverage` block ($ref governance/leverage.schema.yaml) and
          `layout.shared.leverage`.
      - kind: modify
        target: "tools/validator/src/schema-types.mjs"
        semver: none
        notes: >
          `FILENAME_TO_SCHEMA` now maps `leverage` (and `*.leverage.yaml`) → governance/leverage.schema.yaml
          so leverage files are validated against the new schema.
      - kind: modify
        target: "tools/model-builder/src/extraction/entities/leverage.ts, tools/model-builder/src/extraction/relations/leverage.ts"
        semver: none
        notes: >
          Model-builder now extracts `LeveragePoint` (LP###) entities and their outbound relations:
          finding/risk/decision/fitness-function refs (AS-IS), migration_refs + realized_by→WI### (TO-BE),
          advances_goals/advances_value_streams/capability_refs (strategic intent), and a NORMALIZED
          leverage DAG — `depends_on[]` and the inverse of `enables[]` fold into a single
          dependent→prerequisite `leverage_depends_on` edge (deduped), so the interactive leverage view
          gets a clean single-direction graph. Unresolved refs degrade to Missing placeholders. Unblocks
          the interactive leverage view.
      - kind: add
        target: "tools/semantic-checker/rules/leverage-point-no-address.yaml, tools/semantic-checker/rules/leverage-point-no-strategic-intent.yaml"
        semver: none
        notes: >
          Two leverage-point completeness lints. `leverage-point-no-address` (warn): an LP that references
          no finding/risk/decision/fitness-function has no AS-IS anchor (aspirational, not leverage).
          `leverage-point-no-strategic-intent` (info): an LP that advances no goal/value-stream/capability
          states no strategic "why now". Both overridable per-project via `.blueprint-lint.yaml`.
      - kind: add
        target: "examples/prestashop/.blueprint/v2.7/leverage.yaml"
        semver: none
        notes: >
          Worked leverage-map example for the PrestaShop reference model: 5 leverage points (LP001–005),
          `pareto_core`, a two-item `watchlist`, and the full ref repertoire (decisions, fitness functions,
          work-items, value-streams, capabilities, and a depends_on/enables DAG).
  - version: "2.7.3"
    date: "2026-07-04"
    summary: "Operation `dispatch: in-process` — mark commands/queries that execute in-process with no wire transport, exempting them from the missing-exchange-binding completeness check"
    changes:
      - kind: modify
        target: "design/domain.schema.yaml"
        semver: minor
        notes: >
          Added an optional operation-level `dispatch` enum (`in-process`), ORTHOGONAL to
          `exchange`. `dispatch: in-process` declares a command/query executes in-process with no
          wire transport of its own (cross-cutting middleware, scoped-context / data-access steps,
          pure compute, writes embedded in a parent aggregate's endpoint, or in-process
          delegation/write-back). Mutually exclusive with `exchange`. Additive/optional — existing
          operations validate unchanged, and pre-2.7 documents need no migration for it.
      - kind: modify
        target: "tools/semantic-checker/rules/missing-exchange-binding.yaml"
        semver: none
        notes: >
          The completeness check now exempts operations marked `dispatch: in-process` (a structural
          exemption marker, like the queue-payload exemption) — intentionally transport-less
          operations are no longer flagged, while genuinely-missing bindings and unimplemented gaps
          still surface.
      - kind: add
        target: "tools/semantic-checker/rules/dispatch-with-exchange.yaml"
        semver: none
        notes: >
          New warn rule: an operation must not set BOTH `dispatch: in-process` AND an `exchange`
          (mutually exclusive — invoked in-process OR over the wire, not both).
      - kind: modify
        target: "tools/validator/src/validate.mjs"
        semver: none
        notes: >
          The gap check ("has no exchange block") now only flags commands/queries lacking BOTH an
          `exchange` and `dispatch: in-process`; events are no longer flagged (domain facts, exempt).
      - kind: modify
        target: "docs/modeling-guide.md"
        semver: none
        notes: >
          Added a "Transport binding and transport-less operations" section (the in-process flavor
          taxonomy + the bind-⟺-crosses-a-real-boundary rule) and anti-pattern AP41 (Fake
          Transport); clarified "Model This Operation or Skip?" that in-process execution is not a
          skip criterion.
  - version: "2.7.2"
    date: "2026-07-01"
    summary: "Roadmap execution tier — work-item WBS (WI###) with sprint cadence and typed relations to goals/risks/decisions/value-streams/stories/use-cases"
    changes:
      - kind: modify
        target: "governance/roadmap.schema.yaml"
        semver: minor
        notes: >
          Added an optional execution tier below milestones: root `cadence`
          (anchor_sprint + anchor_start + sprint_length_days → sprint→date derivation) and
          `work_items[]`. New `work_item` $def (id WI###; kind
          epic|phase|foundation|subscope|task; recursive via `children`) with sprint OR
          date placement, buffer tail, `status` (lifecycle) + `confidence`
          (committed|estimated|tentative), progress, `milestone` roll-up, owned_by +
          executor[], tracker_ref, depends_on, blockers ($def `blocker`). Typed relation
          arrays (advances_goals/mitigates_risks/realizes_decisions/value_streams/
          user_stories/use_cases) on BOTH milestone and work_item. All additive/optional —
          existing milestone-only roadmaps validate unchanged.
      - kind: add
        target: "metamodel.schema.yaml"
        semver: minor
        notes: >
          Added `work_item_ref` ($def, pattern `^([a-z][a-z0-9-]*\.)?WI\d{3,}$`) for the
          roadmap work-item WBS tier (work_item.depends_on, blocker.blocked_by).
      - kind: modify
        target: "design/domain.schema.yaml"
        semver: minor
        notes: >
          Added `json-rpc` to the operation exchange `protocol` enum and to the RPC
          binding group (requires the `method` sub-field, alongside
          tcp/grpc/trpc/orpc/x-ws). JSON-RPC methods reuse the existing OpenRPC-compatible
          `method` $def (name + params + result). Additive; existing exchanges unaffected.
      - kind: modify
        target: "docs/schema-reference.md, examples/prestashop/.blueprint/v2.7/roadmap.yaml"
        semver: none
        notes: >
          Documented the v2.7.2 roadmap fields + WI### ID pattern (schema-reference §25);
          added a work_items WBS demonstration to the prestashop example roadmap.
      - kind: modify
        target: "tools/model-builder"
        semver: none
        notes: >
          Model-builder now extracts WorkItem entities (WI###, recursive from
          work_items[] + children[]) and roadmap relations: work_item_milestone
          (roll-up), work_item_child (hierarchy), work_item_dependency,
          work_item_blocked_by, plus the shared typed relations (roadmap_advances_goal /
          roadmap_mitigates_risk / roadmap_realizes_decision / roadmap_value_stream /
          roadmap_user_story / roadmap_use_case) on both milestone and work_item.
          Verified on examples/prestashop (4 work items, 0 dangling refs); 210 tests pass.

  - version: "2.7.0"
    date: "2026-05-26"
    summary: "File naming consistency — rename acronym schema files to full descriptive names"
    changes:
      - kind: modify
        target: "tools/semantic-checker — engine extracted to @archally/semantic-checker"
        semver: none
        notes: >
          The semantic-checker engine was extracted to the standalone package
          @archally/semantic-checker (installed from github:archally/semantic-checker#v0.1.0).
          tools/semantic-checker/ is now a thin adapter (BlueprintModel → CheckableModel) plus the
          six rules as declarative YAML; the engine, severity handling, and JSON-Schema rule
          validation come from the package. The blueprint-check CLI, its arguments, exit codes, and
          .blueprint-lint.yaml config are unchanged, and findings on the example models are
          identical (set + messages; output is now ordered deterministically by rule+id). No schema
          change — this is a tooling refactor.
      - kind: rename
        target: "design/rg.schema.yaml → design/infrastructure.schema.yaml"
        semver: major
        notes: >
          Renamed rg.schema.yaml to infrastructure.schema.yaml for consistency
          with other schema files that use full descriptive names. Users must rename
          rg.yaml files to infrastructure.yaml in their .blueprint/ directories.
      - kind: rename
        target: "design/ui.schema.yaml → design/interactions.schema.yaml"
        semver: major
        notes: >
          Renamed ui.schema.yaml to interactions.schema.yaml. Reflects that the
          schema models concrete user-system interaction points (screens, actions,
          navigation), not broad UX concerns.
      - kind: rename
        target: "governance/org.schema.yaml → governance/organization.schema.yaml"
        semver: major
        notes: >
          Renamed org.schema.yaml to organization.schema.yaml for consistency.

  - version: "2.6.3"
    date: "2026-05-09"
    summary: "Bounded Context Canvas v5 — strategic classification, model traits, business decisions, BCC linkage on assumptions and KPIs"
    changes:
      - kind: modify
        target: "design/arch.schema.yaml"
        semver: minor
        notes: >
          Added optional fields on context: business_model_role, evolution (Wardley stage),
          model_traits[] (10-value enum). All optional; existing documents unaffected.
      - kind: add
        target: "governance/decisions.schema.yaml"
        semver: minor
        notes: >
          Added business_decision (BD###) entity and business_decisions[] root array.
          Distinct from decision (D###): a policy statement with linked_contexts[],
          linked_user_stories[], linked_assumptions[], linked_kpis[].
      - kind: modify
        target: "metamodel.schema.yaml"
        semver: minor
        notes: >
          Added context_association_ref pattern for BCC v5 cross-references.
      - kind: modify
        target: "governance/motivation.schema.yaml"
        semver: minor
        notes: >
          Added optional context_associations[] on assumptions and KPIs
          for BCC v5 linkage.
      - kind: modify
        target: "design/quality.schema.yaml"
        semver: minor
        notes: >
          Added optional context_associations[] on KPIs for BCC v5 linkage.

  - version: "2.6.2"
    date: "2026-04-03"
    summary: "Multi-exchange operations, stdio and http-sse protocols"
    changes:
      - kind: modify
        target: "design/domain.schema.yaml"
        semver: minor
        notes: >
          Operations can declare multiple exchange blocks (request/response pairs).
          Added stdio and http-sse protocol options.

  - version: "2.6.1"
    date: "2026-03-27"
    summary: "Decision structured options, epistemic fields, inquiry refs"
    changes:
      - kind: modify
        target: "governance/decisions.schema.yaml"
        semver: minor
        notes: >
          Decisions gain structured options[] with pros/cons/score.
          Added epistemic_status and confidence fields.
      - kind: modify
        target: "governance/motivation.schema.yaml"
        semver: minor
        notes: >
          Inquiries (INQ###) gain refs to decisions, operations, concepts.

  - version: "2.6.0"
    date: "2026-03-19"
    summary: "Value streams, personas as array (breaking), materializes, evidence chains"
    changes:
      - kind: add
        target: "governance/value-stream.schema.yaml"
        semver: minor
        notes: >
          New schema: value streams (VS###) crossing bounded contexts and capabilities.
          Stages reference capabilities; streams reference goals and KPIs.
      - kind: modify
        target: "design/domain.schema.yaml"
        semver: minor
        notes: >
          Operations gain materializes block for entity lifecycle tracking.
          Produces/reacts_to explicitly modeled.
      - kind: modify
        target: "design/concepts.schema.yaml"
        semver: major
        notes: >
          Actor personas changed from single object to array (breaking).
          Enumerations gain transitions_to[] and terminal flag.
      - kind: modify
        target: "metamodel.schema.yaml"
        semver: minor
        notes: >
          Evidence chain fields (evidence_refs, evidence_strength) added to
          shared definitions. CAT### context prefix support.
