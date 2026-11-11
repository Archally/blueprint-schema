# schema-atlas

Generates the **[Blueprint Schema Atlas](../../docs/schema-atlas/)** - a human-readable, versioned,
regenerable projection of the JSON Schema. Layers, entity types, relationships, examples, and a
structural changelog, all derived from schema truth so the docs cannot drift from the metamodel.

> **JSON Schema stays the single source of truth.** The Atlas is a *projection*;
> it never redefines validation truth. This tool + `docs/schema-atlas/**` are its
> only moving parts.

## Commands

```bash
npm run build          # compiles this tool (part of the repo build)
npm run atlas          # regenerate docs/schema-atlas/**
npm run atlas:check    # drift check - non-zero exit if generated docs are stale
```

CLI (`blueprint-atlas <generate|check> [options]`):

| Option | Default | Meaning |
| --- | --- | --- |
| `--version <v>` | `v2.8` | Current schema version slug |
| `--prev <v>` | `v2.6` | Previous version for the changelog diff path |
| `--out <dir>` | `docs/schema-atlas` | Output directory (repo-relative) |
| `--schema-base <d>` | `schema` | Base dir holding schema versions |
| `--overlays <dir>` | `tools/schema-atlas/overlays` | Overlay directory |
| `--repo-root <dir>` | cwd | Repository root |
| `--no-mermaid` / `--no-examples` / `--no-prev` | off | Disable optional projections (reported as `skip`) |

Exit codes: `0` ok · `1` drift (check mode) · `2` generation failure (a `fail` policy fired).

## What it generates

```
docs/schema-atlas/
  README.md              # landing/index (source-of-truth precedence, navigation)
  changelog.md           # structural v2.6 → v2.8 diff (complements root CHANGELOG.md)
  v2.8/
    overview.md          # counts + plane map
    layer-map.md         # per-plane files + bounded dependency diagrams
    entity-catalog.md    # every file: root object + $defs, props, requiredness, enums
    relationships.md     # typed-ID vocabulary + cross-file references
    examples.md          # schema-native + reference + curated examples
```

## Architecture

A pure pipeline (`schema files → IR → Markdown/Mermaid`), so drift detection is a string compare:

| Module | Responsibility |
| --- | --- |
| `schema-io.ts` | Load a version's `*.schema.yaml` files (YAML → objects) |
| `introspect.ts` | Normalize a version into the **Atlas IR** (planes, files, properties, defs, requiredness, enums, deprecation, cross-file relations, typed-ID vocabulary) |
| `provenance.ts` | Hybrid identity - source-true addresses + stable slugs/anchors |
| `overlay.ts` | Load + **guard** overlays (narrow categories; cannot override truth) |
| `diff.ts` | Structural version diff → conservative change classification |
| `mermaid.ts` | Bounded, per-plane diagrams |
| `generate/*.ts` | One module per page |
| `render.ts` | Orchestrate the full file set (pure) |
| `cli.ts` | `generate` / `check` + fail/warn/skip reporting |

## Identity & provenance

- **Internal:** source-true addresses - `file` + JSON Pointer (`design/domain.schema.yaml#/$defs/operation`).
- **External:** stable Atlas slugs/anchors (`#design-domain`) derived from, not replacing, source identity.
- **Every page, definition, and changelog entry shows its source** (`schema/<version>/<file>#<pointer>`),
  plus any overlay that contributed a non-authoritative note.

## Metadata precedence

Schema-native first, overlay second, never override:

1. **JSON Schema** (`title`, `description`, `type`, `required`, `enum`, `deprecated`, `$ref`) - authoritative.
2. **Overlay** - non-authoritative human notes/examples only.
3. **Generated projection** - the rendered Markdown.

## Overlay contract

Overlays live in `overlays/*.overlay.yaml`. A file named `v2.7.overlay.yaml` applies only to that
version; any other name (e.g. `changelog.overlay.yaml`) is shared. Each entry addresses a
version-relative `target` (`<file>` or `<file>#<json-pointer>`).

Allowed categories - nothing else is accepted:

| Category | Renders in | Purpose |
| --- | --- | --- |
| `explanatory-note` | entity catalog | Clarify a definition the schema states tersely |
| `modeling-guidance` | entity catalog | How to model with this construct |
| `migration-note` | (attached to target) | Upgrade guidance |
| `changelog-rationale` | changelog | Why a change matters |
| `curated-example` | examples | An illustrative, non-authoritative example |
| `rename-annotation` | changelog | Promote a conservative add/remove into a proven `rename` |

**Guard:** the loader rejects (hard `fail`) any entry containing a validation-truth key -
`type`, `required`, `enum`, `properties`, `pattern`, `$ref`, `oneOf`, `anyOf`, `allOf`, `const`,
`additionalProperties` - or an unknown category. Overlays can *explain*, never *redefine*.

## Fail / warn / skip policy

Never silent. Every degradation and omission is reported in logs.

- **Fail** (exit 2) - truth-threatening: schema unparseable, overlay overrides truth, provenance
  cannot be established. No files written.
- **Warn** (exit 0) - output stays trustworthy but degraded: a diagram is dense, a richer
  classification fell back to a conservative one, examples are partial.
- **Skip** (exit 0) - an optional projection was intentionally omitted (e.g. `--no-mermaid`,
  no previous version, no schema-native examples). Always logged, never silent.

## Determinism

No timestamps, stable ordering, normalized newlines. Re-running generation without a schema change
produces **no diff**, which is what makes `atlas:check` a reliable CI gate.

## Governance & contributor workflow

- **Do not hand-edit `docs/schema-atlas/**`.** Each file carries a `GENERATED … do not edit` banner.
  Change the **schema** (validation truth) or an **overlay** (human semantics), then `npm run atlas`.
- **Rename claims require an annotation.** Add a `rename-annotation` overlay entry; the diff stamps
  the basis so the claim is auditable.
- **Semantic notes belong in overlays**, addressed to a source-true target - not in the generated
  Markdown and not in the schema `description` unless they are genuinely part of the contract.
- **Review flow:** schema/overlay PR → `npm run atlas` → commit regenerated docs → CI `atlas:check`
  confirms they match.

## Documentation roles

The root README, modeling guide, file conventions and schema reference provide hand-authored
usage guidance. The Atlas provides generated reference pages; edit schema or overlays and
regenerate these pages.

## Validation coverage

Automated: `npm test` (introspection, diff, overlay-guard) + `npm run atlas:check` (determinism/drift).

Schema fixture tests accept `BLUEPRINT_ATLAS_TEST_SCHEMA_ROOT`, the directory containing version
folders. When unset, they read `schema/` from the repository root. Overlay fixtures use this
tool's `overlays/` directory.
