# Blueprint Schema Changelog
# All schema version releases in reverse chronological order.
---
entries:
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
