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

> A v2.6 model reaching 2.7.4 needs **both** updates, and they run in a **single invocation**: the
> applicable updates are resolved up front and applied in order. When an update renames the version
> directory (`v2.6 → v2.7` does), the run follows the model to its new location. Every update is
> idempotent, so re-running is safe.

`--dry-run` shows the full route and the planned changes for the first update, then lists the updates
that follow. Later updates act on the tree the earlier ones produce, so their changes are reported
when you apply.

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
