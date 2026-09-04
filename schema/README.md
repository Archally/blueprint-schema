# Blueprint Schema — Versions

This folder holds the versioned JSON-Schema (YAML, draft 2020-12) bundles. Each `v{N}/` is a **self-contained schema set** — validate your `.blueprint/v{N}/` model files against the matching version.

| Version | Status | Notes |
| --- | --- | --- |
| [**v2.8**](./v2.8/) | **Current** | The enforcement line: typed ids on parties, contexts, services, resources and scopes are required, a typed reference to an id nothing declares is an error, and the free-string `service.resources` list and root `infrastructure:` map are gone. Accepts v2.7-v2.2 documents that already meet those rules. |
| [v2.7](./v2.7/) | Maintained | Previous stable line. Files renamed for clarity (`infrastructure`, `interactions`, `organization`); kept for back-compatibility. |
| [v2.6](./v2.6/) | Maintained | Older stable line; kept for back-compatibility. |

Browse into a version for a per-plane index (**Design** / **Governance**) plus the cross-cutting **metamodel** and **migration** schemas.

For a human-readable projection of these schemas — layer map, entity catalog, relationships, and a structural changelog, all generated from schema truth — see the [**Blueprint Schema Atlas**](../docs/schema-atlas/).

## Choosing a version

- **New projects →** start with **[v2.8](./v2.8/)**.
- **Existing v2.7 or v2.6 models →** stay where they are, or migrate - the `blueprint-schema-update` tool carries a model to v2.8 in one run (v2.6: the file renames; v2.7: the missing typed ids are minted, free-string resource and scope ids are retyped with every reference to them). What it will not guess, it reports; `schema/v2.8/MIGRATION.md` is the guide.

## Versioning policy ([SemVer](https://semver.org/))

- **Major** (`3.0.0`) — breaking schema changes
- **Minor** (`2.7.0`) — new optional fields or entity types
- **Patch** (`2.6.1`) — documentation, clarifications, validator fixes

Full version history: [CHANGELOG](../CHANGELOG.md). Complete reference (ID patterns, traceability map): [docs/schema-reference.md](../docs/schema-reference.md). Project overview: [README](../README.md).

<!-- Hand-maintained (publication-native — not generated/ported). When a new schema version is published: add a row above, and flip the prior "Current" to "Maintained". -->
