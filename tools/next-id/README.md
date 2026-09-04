# next-id

Allocate the next free typed id for a blueprint model — deterministically, so an authoring agent
never guesses and never greps.

```bash
node tools/next-id/cli.mjs CMD --model .blueprint/v2.8
node tools/next-id/cli.mjs CMD --model .blueprint/v2.8 --scope catalog
node tools/next-id/cli.mjs SVC --model .blueprint/v2.8 --band 500-599 --count 3 --json
```

| Flag | Meaning |
|---|---|
| `<PREFIX>` | entity-kind prefix — `CMD`, `EVT`, `QRY`, `SVC`, `BC`, `MDL`, … each an independent counter |
| `--model <dir>` | model root (the `.blueprint/vN` directory). Scanned recursively |
| `--scope <ns>` | namespace: `catalog` → `catalog.CMD042`. Omit for a bare id |
| `--band <min>-<max>` | stay inside a reserved numeric range; exit 1 when it is exhausted |
| `--count <n>` | allocate a contiguous block |
| `--json` | machine-readable (`{id}` or `{ids}`, plus `prefix`, `scope`, `filesScanned`) |

Exit codes: **0** allocated · **1** band exhausted · **2** usage or IO error.

## The rule that makes this worth running

**Ids are global per prefix.** `CAT001` used anywhere in the model — any file, any context, any
scope — makes `CAT001` unavailable everywhere. A reused id is valid YAML, passes the schema, and
silently merges two entities in the graph; nothing downstream will tell you. That is why the tool
scans **every** document under `--model`, not the file you happen to be editing.

Scoping is a namespace *within* that rule, not an escape from it. `catalog.CMD042` and
`checkout.CMD042` are distinct, but `CMD042` bare is a third thing again. Asking for a bare prefix
in a model where every id is scoped is the classic misuse — you get an id that looks free because
nothing bare exists yet. The tool prints a hint to **stderr** when it detects exactly that shape:

```
hint: no bare CMD ids in this model; scoped CMD ids exist under
      [admin, catalog, checkout, …] — did you mean --scope <namespace>?
```

Hints go to stderr precisely so `ID=$(next-id CMD --model .)` still captures a clean id.

Allocation is **gap-unaware** (`max + 1`): a deleted `CMD007` is not recycled. Ids are permanent
identifiers, and reissuing one would silently rebind every dangling reference to it.

## One implementation, two callers

`allocate.mjs` is **generated** — do not edit it. Its source is the shared id-allocator module that
the **Archally Pro** CLI ([archally.pro](https://archally.pro)) and the Blueprint MCP server import
directly; the generated file is the plain ESM form this zero-build tool runs.

So `bp next-id` and this tool are not two implementations kept in agreement by a test — they are one
implementation with two front ends. Verified on a 172-file model: identical answers for bare, scoped,
banded and multi-count allocation. Only `cli.mjs` (argument parsing, YAML harvesting, output) is
written twice, and it contains no allocation logic.

Editing `allocate.mjs` locally makes the two disagree; `tools/port/verify-ported.mjs` will fail in CI.
Upstream the change to the `.ts` instead.
