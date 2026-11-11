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
blueprint-schema-validate .blueprint/v2.8
```

## Updates are chained

`resolveChain(version)` returns **every** applicable update in order, not just the first. A v2.6
model receives `001` (2.6→2.7) **and** `002` (in-place 2.7) in a single run; the runner follows the
model when a hop copies it into the next version directory, as `001` does.

Two constraints for anyone adding a module:

- **Register it in version order.** The resolver makes a *single pass* over `ALL_UPDATES`. It must:
  `002` declares `sourceVersion: '2.7'` and `targetVersion: '2.7'`, so "loop while something matches"
  would never terminate. `runner.test.ts` asserts the ordering the single pass depends on.
- **`--dry-run` plans hop 1 only.** Later hops transform the tree the earlier one produces, so they
  are announced rather than planned - a plan computed against the pre-migration tree would be fiction.

Update modules are numbered in the order they are registered. The numbers are not contiguous; `--list` prints what is registered.

## Available Updates

| Update | Changes |
|--------|---------|
| v2.6 → v2.7 | Rename `rg.yaml` → `infrastructure.yaml`, `ui.yaml` → `interactions.yaml`, `org.yaml` → `organization.yaml` |
| v2.7 → v2.7 (2.7.4) | Quality two-level: remap `finding.quality_characteristic` values `modularity`/`analysability`/`reusability`/`testability` (no longer valid top-level ISO 25010:2011 values) → `quality_characteristic: maintainability` + `quality_subcharacteristic: <value>` |
| v2.7 → v2.7 (2.7.x) | Arch party ids: give every `parties[]` entry in an arch document a `PRT###`, adopting the org party's id when the names match exactly. A party is dual-sourced and re-declared per slice, so the shared id is what makes those declarations one party - and `party.id` becomes REQUIRED in v2.8 |
| v2.7 → v2.8 | v2.8 typed ids: mint `BC###`/`SVC###` for contexts and services that carry none, retype free-string `IR###`/`DSC###` ids **and every reference to them**, bump `schemaVersion` to `2.8.0`, write the result into `v2.8/`, leaving `v2.7/` in place. Reports a party still missing a `PRT###` rather than minting one - that is `004`'s job, and `004` runs first in the chain. Reports every `service.resources` list and root `infrastructure:` map of an arch document - v2.8 no longer accepts either, and neither has a rewrite: a resource category is not a resource, and the map's values are prose. The line stays, the version is bumped, and the validator then names the property |
| v2.8 → v2.8 (2.8.1) | Root-declared contexts: every bounded context is declared once at its document root, every party once in the model root arch document, and a service names its system through `system_ref` or the document default |
| v2.8 → v2.8 (2.8.6) | Domain registry: every slice that classified itself (`type`) or declared `subdomains` seeds a domain in `blueprint.yaml` `domains[]` with a `DMN###` id, its subdomains get `SDM###` ids, `type` and `subdomains` leave the slice, and a context's `domain_ref` names the domain by id instead of the slice by name. A subdomain's `kind` is written as `type` in the v2.8 vocabulary (`core` to `core-domain`, `supporting` to `supporting-domain`, `generic` to `generic-domain`); a value no version accepts is dropped and named. A root `domains:` free-string map in an architecture or process document is a second source: each key becomes a domain with the prose as its `description` and leaves the document, even when it matches no slice; a key naming a domain the registry already declares stays put and is reported. Flow-style `slices:` and a flow-style slice entry are reported and left alone |
| v2.8 → v2.8 (2.8.10) | `story` becomes `process`: `STR###` to `PRC###`, `SA###` to `PA###`, `stories:` to `processes:`, and the `process` sub-object flattened into the entity so `SP###` retires. The story files are renamed with it |
| v2.8 → v2.8 (2.8.11) | Retire the one-letter id bands: `D###` to `DC###`, `R###` to `RSK###`, `G###` to `GL###`, `T###` to `TRO###`, `A###` to `ASM###`, `AS###` to `ASC###`, whole-word and context-prefix aware. Runs after the narrative rename, which walks the same files |
| v2.8 → v2.8 (2.8.12) | Retire the watch-item band: `W###` to `WCH###` on a watchlist entry's own id. Every other `W###` is reported rather than touched - one band's letter is not evidence about another's |
| v2.8 → v2.8 (2.8.14) | Split a contract `output:` into the facts it fused: `contract_name` names the document, `slice` or `cross_cutting` places it, and the contract kind selects the serialization |
| v2.8 → v2.8 (2.8.23) | `next_activities` becomes `next`: each successor moves to a `to:` entry that can carry the condition taking that branch. A fork expands to block style, where a condition belongs; a lone successor stays on its line. No condition is invented - the older key carried none |
| v2.8 → v2.8 (2.8.27) | `handles` becomes `contracts.inprocess.provide`: a service's owned operations move under the coupling that carries them, into the existing `contracts:` block or into one minted where the old key stood. A service already declaring `contracts.inprocess`, and a `contracts:` in flow form, are reported and left alone. `provides:` is reported too - the schema dropped it in the same version with no replacement |
| v2.8 → v2.8 (2.8.27) | `dispatch: in-process` becomes `dispatch: inprocess`, converging on the spelling of the contract kind that carries it. Both values validate, so this is a convergence rather than a repair. Rewritten only where `dispatch:` opens a mapping entry, so the same words inside a summary or a rationale are left as the author wrote them |

> A model reaches the current 2.8 shape in **one** run, whatever version it starts on: `resolveChain`
> returns **13** hops from v2.6, **12** from v2.7 and **9** from v2.8, in the order the runner
> registers them, and the runner follows the model through the directory rename. Each hop is
> idempotent, so a re-run on a migrated model reports no changes. `--list` prints
> what is registered.
>
> **`party.id` does not exist before v2.7**, so the arch-party-ids update must never run against a
> pre-2.7 model - it would add a property the older schema rejects. The version gate is what
> prevents that: it is `sourceVersion: '2.7'`, and `resolveChain` only reaches it once a model is on
> 2.7. Call the modules through the runner, never directly.

## How It Works

1. **Detect** - reads version from directory name (`v2.6`) or `blueprint.yaml`
2. **Plan** - scans for files matching old naming patterns, checks `blueprint.yaml` for property keys to update
3. **Apply** - copies the model into the next version directory, then renames files, updates YAML property keys and path references in the copy

Each update is a self-contained module in `src/updates/` with a `plan()` and `apply()` function. Adding support for a new version update means adding a new file (e.g., `002-next-change.ts`).

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Show planned changes without applying |
| `--list` | List all available schema updates |
| `--help`, `-h` | Show help message |

## Safety

- **Dry-run first** - always preview with `--dry-run` before applying
- **Idempotent** - running on an already-updated model reports "no changes needed"
- **No data loss** - the source version directory is copied, never moved, so the version the model came from survives the run unchanged; a run that cannot finish leaves it untouched, and a target directory that already exists is refused rather than merged into
- **Validate after** - run `blueprint-schema-validate` to confirm the updated model is valid

## Adding New Updates

Create a new file in `src/updates/` following the naming convention:

```
002-descriptive-name.ts
```

Export a `SchemaUpdate` object with `sourceVersion`, `targetVersion`, `description`, `plan()`, and `apply()` functions. Register it in `src/runner.ts`.
