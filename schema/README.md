# Blueprint Schema — Versions

This folder holds the versioned JSON-Schema (YAML, draft 2020-12) bundles. Each `v{N}/` is a **self-contained schema set** — validate your `.blueprint/v{N}/` model files against the matching version.

| Version | Status | Notes |
| --- | --- | --- |
| [**v2.7**](./v2.7/) | **Current** | Latest. Files renamed for clarity (`infrastructure`, `interactions`, `organization`); v2.7 schemas also accept v2.6–v2.2 documents for forward-compatibility. |
| [v2.6](./v2.6/) | Maintained | Previous stable line; kept for back-compatibility. |

Browse into a version for a per-plane index (**Design** / **Governance**) plus the cross-cutting **metamodel** and **migration** schemas.

## Choosing a version

- **New projects →** start with **[v2.7](./v2.7/)**.
- **Existing v2.6 models →** stay on v2.6, or migrate — the `blueprint-schema-update` tool automates `v2.6 → v2.7` (renames `ui`→`interactions`, `rg`→`infrastructure`, `org`→`organization`).

## Versioning policy ([SemVer](https://semver.org/))

- **Major** (`3.0.0`) — breaking schema changes
- **Minor** (`2.7.0`) — new optional fields or entity types
- **Patch** (`2.6.1`) — documentation, clarifications, validator fixes

Full version history: [CHANGELOG](../CHANGELOG.md). Complete reference (ID patterns, traceability map): [docs/schema-reference.md](../docs/schema-reference.md). Project overview: [README](../README.md).

<!-- Hand-maintained (publication-native — not generated/ported). When a new schema version is published: add a row above, and flip the prior "Current" to "Maintained". -->
