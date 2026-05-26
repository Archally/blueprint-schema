# Blueprint Schema Changelog
# All schema version releases in reverse chronological order.
---
entries:
  - version: "2.7.0"
    date: "2026-05-26"
    summary: "File naming consistency — rename acronym schema files to full descriptive names"
    changes:
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
