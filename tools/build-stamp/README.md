# build-stamp

Gives a blueprint model a stable, content-addressed **build identity** that downstream renderers/visualizers can
stamp on every generated artifact — so an exported diagram, PDF, or page traces back to the exact model state it was
produced from.

## What it does

Computes a `buildId` and writes `<model>/build.json`:

```json
{
  "buildId": "2026-01-15-a1b2c3d",
  "updatedAt": "2026-01-15T09:30:00.000Z",
  "model": "v2.7",
  "files": 128,
  "note": "…"
}
```

`buildId = <UTC-date>-<hash7>` where `hash7` is the first 7 hex of a **sha256** over every model `*.yaml` file under
the model directory (sorted by relative path; path + content folded in). It is **deterministic** — it changes iff the
model content changes — so re-running without edits reproduces the same id, and any content change yields a new one.
Non-YAML files (working notes, `build.json` itself) never feed the hash.

## Usage

```bash
node tools/build-stamp/src/cli.mjs --model <dir>            # write <dir>/build.json
node tools/build-stamp/src/cli.mjs --model <dir> --check    # compute + compare, write nothing; exit 1 if stale
```

| Flag | Meaning |
|---|---|
| `-m, --model <dir>` | Blueprint model directory to stamp (default `.blueprint/v2.8`). Writes `<dir>/build.json`. |
| `-c, --check` | Compute the buildId and compare to the committed `build.json` without writing; **exit 1** if stale. Suited to CI / a pre-commit hook. |
| `-h, --help` | Show help. |

Zero runtime dependencies (Node builtins only).

## Workflow

- **Bump once per model batch, before committing** — not on every re-render. Re-rendering must not change the buildId;
  only model edits do.
- **Renderers read `build.json`** (they should not recompute it) and stamp e.g.
  `Generated <UTC timestamp> · blueprint <buildId>` onto each artifact. A renderer that can't find `build.json` should
  fall back to an "unversioned" marker rather than fail.
- **CI / pre-commit:** run with `--check` to fail the build when the committed `build.json` is stale relative to the
  model content.

## Example

```bash
# stamp an online-store blueprint before committing
node tools/build-stamp/src/cli.mjs --model examples/online-store/.blueprint/v2.8
#   buildId 2026-01-15-a1b2c3d  (128 model files)  ->  examples/online-store/.blueprint/v2.8/build.json
```
