# coverage-check — does the blueprint still describe the code?

Zero-build, zero-config beyond `yaml`. Reports **both** drift directions between a blueprint's
`code_refs` and the source tree.

```bash
# code → model: did anything model the files I just changed?
node tools/coverage-check/cli.mjs $(git diff --name-only main) --model .blueprint/v2.8

# model → code: does the blueprint still point at files that exist?
node tools/coverage-check/cli.mjs --model .blueprint/v2.8 --audit

# both, gating CI
node tools/coverage-check/cli.mjs $(git diff --name-only main) --model .blueprint/v2.8 --audit --strict
```

| Flag | Effect |
|---|---|
| `--model <dir>` | Blueprint directory to scan (default `.`) |
| `--audit` | Also run the model→code direction: check every `code_ref` against disk |
| `--code-root <dir>` | Where the referenced source lives (default `.`); `code_ref.path` is relative to it |
| `--strict` | Exit 1 when there are gaps — otherwise gaps are warnings and the exit is 0 |
| `--json` | Machine-readable report |
| `--no-suffix` | Disable tail matching; require exact or containment matches only |

## The two directions, and why one is not enough

**code → model.** Pass the paths you changed. Any path no entity references is listed under
*Paths no entity references* — code changed without a blueprint update. This is the direction a
match list alone cannot show: with three changed paths and one match, a tool that only prints
matches looks like success.

**model → code** (`--audit`). Every `code_ref` is resolved against `--code-root`. Refs whose file is
gone are the blueprint describing source that has been moved, renamed or deleted. Run it on any
model older than a few months; drift is the normal state, not the exception.

## Matching is segment-aligned

Comparisons are anchored on `/` boundaries. Querying `src/Cart` does **not** match
`src/CartRule/Query/SearchCartRules.php`. Measured on a 691-ref model, raw substring matching
produced 107 false positives of exactly that shape, and segment matching lost no real match.

Every match row states *why* it matched, so a surprising row can be audited rather than trusted:

| `matchKind` | Meaning |
|---|---|
| `exact` | Identical paths |
| `ref-under-query` | The query is a directory containing the ref |
| `query-under-ref` | The ref is a directory containing the query — **broad**: one entity referencing `src/Core/Domain/` makes every file beneath it count as covered. Watch for this kind in the output when a path you expected to be flagged is not |
| `suffix` | Segment-aligned tail match — for refs written relative to a sub-package root (`--no-suffix` disables) |

## Cross-repo refs are never called dangling

`code_ref.path` may use the metamodel's cross-repo form, `org/repo#path/to/file`. Those files are
not in this clone, so they are reported as **unverifiable** and excluded from the dangling count.
Reporting an unreachable file as "missing" would make the whole audit untrustworthy on first run.

## Relationship to `bp coverage-check`

`bp` is the **Archally Pro** CLI ([archally.pro](https://archally.pro)) — a separate commercial
product, not part of this package. It exposes the same coverage analysis as a verb.

The analysis is the same code: `analyze.mjs` is **generated** from the very module the Pro CLI
imports, so neither tool can drift into a different verdict — there is only one implementation.
Do not edit `analyze.mjs`.

The shared core guarantees the same *analysis*, not the same *corpus*, and the two callers feed it
differently:

| | `bp coverage-check` | this tool |
|---|---|---|
| Reads | the built model (extracted entities) | raw YAML |
| Entity label | `displayId` (`architecture-viewer-frontend`) | the typed `id` (`archally-platform.SVC001`) |
| Type label | the model builder's type (`Operation`) | the containing YAML key (`services`) |
| Corpus | entities the extractors produce | **any** object carrying a `code_refs` array |

The last row is a real difference: on the Archally self-model this tool audits 108 refs to `bp`'s
105, because a quality *finding* carries `code_refs` and findings are not extracted as entities. For
a coverage audit that is the more complete answer — a `code_refs` entry anywhere in the model is a
claim about source, whether or not the graph builder makes a node from it.
