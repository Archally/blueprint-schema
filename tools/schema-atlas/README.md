# schema-atlas

Generates the **[Blueprint Schema Atlas](../../docs/schema-atlas/)** — a human-readable, versioned,
regenerable projection of the JSON Schema. Layers, entity types, relationships, examples, and a
structural changelog, all derived from schema truth so the docs cannot drift from the metamodel.

> **JSON Schema stays the single source of truth (DEC-ATL-01).** The Atlas is a *projection*
> (DEC-ATL-02); it never redefines validation truth. This tool + `docs/schema-atlas/**` are its
> only moving parts.

## Commands

```bash
npm run build          # compiles this tool (part of the repo build)
npm run atlas          # regenerate docs/schema-atlas/**
npm run atlas:check    # drift check — non-zero exit if generated docs are stale
```

CLI (`blueprint-atlas <generate|check> [options]`):

| Option | Default | Meaning |
| --- | --- | --- |
| `--version <v>` | `v2.7` | Current schema version slug |
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
  changelog.md           # structural v2.6 → v2.7 diff (complements root CHANGELOG.md)
  v2.7/
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
| `provenance.ts` | Hybrid identity — source-true addresses + stable slugs/anchors (DEC-ATL-13) |
| `overlay.ts` | Load + **guard** overlays (narrow categories; cannot override truth) |
| `diff.ts` | Structural version diff → conservative change classification (DEC-ATL-19) |
| `mermaid.ts` | Bounded, per-plane diagrams (DEC-ATL-14) |
| `generate/*.ts` | One module per page |
| `render.ts` | Orchestrate the full file set (pure) |
| `cli.ts` | `generate` / `check` + fail/warn/skip reporting |

## Identity & provenance (DEC-ATL-12, DEC-ATL-13)

- **Internal:** source-true addresses — `file` + JSON Pointer (`design/domain.schema.yaml#/$defs/operation`).
- **External:** stable Atlas slugs/anchors (`#design-domain`) derived from, not replacing, source identity.
- **Every page, definition, and changelog entry shows its source** (`schema/<version>/<file>#<pointer>`),
  plus any overlay that contributed a non-authoritative note.

## Metadata precedence (DEC-ATL-08)

Schema-native first, overlay second, never override:

1. **JSON Schema** (`title`, `description`, `type`, `required`, `enum`, `deprecated`, `$ref`) — authoritative.
2. **Overlay** — non-authoritative human notes/examples only.
3. **Generated projection** — the rendered Markdown.

## Overlay contract (DEC-ATL-17, VAL-ATL-006)

Overlays live in `overlays/*.overlay.yaml`. A file named `v2.7.overlay.yaml` applies only to that
version; any other name (e.g. `changelog.overlay.yaml`) is shared. Each entry addresses a
version-relative `target` (`<file>` or `<file>#<json-pointer>`).

Allowed categories — nothing else is accepted:

| Category | Renders in | Purpose |
| --- | --- | --- |
| `explanatory-note` | entity catalog | Clarify a definition the schema states tersely |
| `modeling-guidance` | entity catalog | How to model with this construct |
| `migration-note` | (attached to target) | Upgrade guidance |
| `changelog-rationale` | changelog | Why a change matters |
| `curated-example` | examples | An illustrative, non-authoritative example |
| `rename-annotation` | changelog | Promote a conservative add/remove into a proven `rename` |

**Guard:** the loader rejects (hard `fail`) any entry containing a validation-truth key —
`type`, `required`, `enum`, `properties`, `pattern`, `$ref`, `oneOf`, `anyOf`, `allOf`, `const`,
`additionalProperties` — or an unknown category. Overlays can *explain*, never *redefine*.

## Fail / warn / skip policy (DEC-ATL-21)

Never silent. Every degradation and omission is reported in logs.

- **Fail** (exit 2) — truth-threatening: schema unparseable, overlay overrides truth, provenance
  cannot be established. No files written.
- **Warn** (exit 0) — output stays trustworthy but degraded: a diagram is dense, a richer
  classification fell back to a conservative one, examples are partial.
- **Skip** (exit 0) — an optional projection was intentionally omitted (e.g. `--no-mermaid`,
  no previous version, no schema-native examples). Always logged, never silent.

## Determinism (DEC-ATL-09)

No timestamps, stable ordering, normalized newlines. Re-running generation without a schema change
produces **no diff** (VAL-ATL-010), which is what makes `atlas:check` a reliable CI gate.

## Governance & contributor workflow

- **Do not hand-edit `docs/schema-atlas/**`.** Each file carries a `GENERATED … do not edit` banner.
  Change the **schema** (validation truth) or an **overlay** (human semantics), then `npm run atlas`.
- **Rename claims require an annotation.** Add a `rename-annotation` overlay entry; the diff stamps
  the basis so the claim is auditable.
- **Semantic notes belong in overlays**, addressed to a source-true target — not in the generated
  Markdown and not in the schema `description` unless they are genuinely part of the contract.
- **Review flow:** schema/overlay PR → `npm run atlas` → commit regenerated docs → CI `atlas:check`
  confirms they match.

## CI rollout (DEC-ATL-20)

`atlas:check` runs in [`.github/workflows/validate.yml`](../../.github/workflows/validate.yml) as
**advisory** (`continue-on-error: true`) so it reports drift without blocking. **Promotion to
enforced:** once the generated output has been stable across a few schema changes with no
formatting-only churn, flip `continue-on-error` to `false`.

## Documentation migration matrix (Step 05)

Every retained doc keeps an explicit role so readers know what they are looking at:

| Doc | Role | Relationship to the Atlas |
| --- | --- | --- |
| `README.md` (root) | `canonical manual overview` | Hand-authored narrative; links to the Atlas |
| `docs/schema-reference.md` | `canonical manual overview` (→ `transition doc`) | Deep hand-authored reference; overlaps the entity catalog. Candidate to slim toward ID-patterns/traceability as the catalog proves out |
| `docs/modeling-guide.md`, `docs/file-conventions.md` | `canonical manual overview` | Authoring guidance; out of Atlas scope |
| `schema/README.md` | `canonical manual overview` | Version index; links to the Atlas |
| `schema/v*/README.md` | `generated reference` | Generated per-version index (existing generator). Cross-link belongs in that generator's template, **not** hand-edited here |
| `docs/schema-atlas/**` | `generated reference` | This tool's output — do not hand-edit |

Deprecation path: when the entity catalog fully covers a hand-maintained reference section, mark
that section `deprecated redirect` pointing at the Atlas rather than deleting it outright.

## Validation coverage

Automated: `npm test` (introspection, diff, overlay-guard) + `npm run atlas:check` (determinism/drift).
The generated pages satisfy VAL-ATL-001..020 from the plan; see
[`.plans/2026-07-01-blueprint-schema-atlas`](../../.plans/2026-07-01-blueprint-schema-atlas/).
