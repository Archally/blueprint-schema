# Blueprint Schema Update

Automated schema version updates for blueprint models. Detects the current schema version, plans the required changes, and applies them safely.

## Usage

```bash
# Preview what would change (recommended first step)
blueprint-schema-update .blueprint/v2.6 --dry-run

# Apply the update
blueprint-schema-update .blueprint/v2.6

# List all available updates
blueprint-schema-update --list

# Verify after update
blueprint-schema-validate .blueprint/v2.7
```

## Available Updates

| Update | Changes |
|--------|---------|
| v2.6 → v2.7 | Rename `rg.yaml` → `infrastructure.yaml`, `ui.yaml` → `interactions.yaml`, `org.yaml` → `organization.yaml` |
| v2.7 → v2.7 (2.7.4) | Quality two-level: remap `finding.quality_characteristic` values `modularity`/`analysability`/`reusability`/`testability` (no longer valid top-level ISO 25010:2011 values) → `quality_characteristic: maintainability` + `quality_subcharacteristic: <value>` |

> A v2.6 model reaching 2.7.4 needs **both** updates — and since 2.7.8 they run in **one invocation**.
> The runner resolves the whole chain up front and follows the model when a hop relocates it
> (`v2.6 → v2.7` renames the version directory). Each hop is still idempotent, so a re-run is safe.
>
> Previously only the first applicable update ran, so this was a manual two-step and `002` stayed
> unapplied unless you noticed and re-ran on the new directory.

**`--dry-run` plans the first hop precisely and announces the rest.** A later hop transforms the tree
the earlier one produces, so planning it against the current tree would be fiction, not a preview.

**Numbering: `001`, `002`, then `004` — there is no `003`.** It was allocated for the
rg→infrastructure rename that `001` already performs, and was never authored. The gap is deliberate.

> **Source of truth is the Archally monorepo** (`schemas/blueprint/.shared/schema-update`). This copy
> is a port verified against a checked-in hash manifest; local edits fail the parity gate. The same
> modules back the monorepo's `bp schema-update` verb, so both stacks migrate identically.

## How It Works

1. **Detect** — reads version from directory name (`v2.6`) or `blueprint.yaml`
2. **Plan** — scans for files matching old naming patterns, checks `blueprint.yaml` for property keys to update
3. **Apply** — renames files, updates YAML property keys and path references, renames the version directory

Each update is a self-contained module in `src/updates/` with a `plan()` and `apply()` function. Adding support for a new version update means adding a new file (e.g., `002-next-change.ts`).

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Show planned changes without applying |
| `--list` | List all available schema updates |
| `--help`, `-h` | Show help message |

## Safety

- **Dry-run first** — always preview with `--dry-run` before applying
- **Idempotent** — running on an already-updated model reports "no changes needed"
- **No data loss** — only renames files and updates property keys; never deletes content
- **Validate after** — run `blueprint-schema-validate` to confirm the updated model is valid

## Adding New Updates

Create a new file in `src/updates/` following the naming convention:

```
002-descriptive-name.ts
```

Export a `SchemaUpdate` object with `sourceVersion`, `targetVersion`, `description`, `plan()`, and `apply()` functions. Register it in `src/runner.ts`.
