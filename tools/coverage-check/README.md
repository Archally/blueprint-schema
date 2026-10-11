# coverage-check - does the blueprint still describe the code?

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
| `--code-root <dir>` | Where the model's own repository is checked out; `code_ref.path` is relative to it. Without it the root is found from the model's `repository.url` (see [Where the code is](#where-the-code-is)) |
| `--strict` | Exit 1 when there are gaps or the audit did not run; otherwise both are warnings and the exit is 0 |
| `--json` | Machine-readable report |
| `--no-suffix` | Disable tail matching; require exact or containment matches only |

Exit codes: 0, with gaps or an audit that did not run reported as warnings; 1 with `--strict` when
any queried path is unreferenced, any `code_ref` is missing or outside its root, or the audit did
not run; 2 for a usage error, including a `--code-root` that does not exist.

## The two directions, and why one is not enough

**code → model.** Pass the paths you changed. Any path no entity references is listed under
*Paths no entity references*: code changed without a blueprint update. This is the direction a
match list alone cannot show: with three changed paths and one match, a tool that only prints
matches looks like success.

**model → code** (`--audit`). Every `code_ref` is resolved against the root of the repository it
names. Refs whose file is gone are the blueprint describing source that has been moved, renamed or
deleted. Run it on any model older than a few months; drift is the normal state, not the exception.

## Where the code is

A `code_ref` path is relative to the root of a repository: the model's `repository.url` for an
unprefixed path, the `url` of a `repositories:` entry for an `org/repo#path` one. The model names
each repository by its remote address and never by a directory, so `--audit` finds each one on
this machine, in this order:

1. `--code-root <dir>`, when given. It names the primary repository only; a prefix keeps its own root.
2. **The model's own clone**: a remote of the git repository holding the model directory names the
   same repository as the URL. Every remote is compared, not only `origin`. The root is that
   repository's top level, a worktree's when the model sits in a worktree.
3. **The per-machine mapping**: `~/.archally/repositories.yaml` (`%USERPROFILE%\.archally\repositories.yaml`
   on Windows), or the file the `ARCHALLY_REPOSITORIES_FILE` environment variable names instead. It
   is read, never created:

   ```yaml
   repositories:
     https://github.com/PrestaShop/PrestaShop: ~/src/PrestaShop
     git@github.com:PrestaShop/ps_apiresources.git: /work/clones/ps_apiresources
   ```

   A key is a URL in any spelling: scp-like, `ssh://` and `https://` forms of one repository are
   equal, and the host and path are compared without case. A value is an absolute or `~/` path; on
   Windows write it with forward slashes or in single quotes. For a mapped clone the output names
   the branch and commit it has checked out, and the branch the model declares when they differ.
   Nothing is switched or refused.
4. **No `repository.url` declared**: the top level of the git repository holding the model, and the
   output says so.
5. Otherwise **none**, with the reason: the URL, every remote compared, and the mapping file read.

git is asked only for a repository's top level, its remotes and, for a mapped clone, its branch and
commit; nothing reads or writes an index. A mapping file that is not YAML, an entry that is refused,
two keys naming one repository, or an entry whose directory is missing or whose remotes name another
repository is reported in `resolverWarnings` and on a `Warning:` line. Host aliases from
`~/.ssh/config` are not matched; map the repository instead.

Each `code_ref` gets one status:

| status | meaning |
|---|---|
| `present` | the file exists under its repository's root |
| `missing` | it does not: listed in `danglingRefs` |
| `unverifiable` | its repository has no root on this machine, or the prefix is not declared under `repositories:`; `reason` says which |
| `outside-root` | the path is absolute or climbs out of its root with `..`; listed in `outsideRootRefs` and never probed |

An `unverifiable` ref is never counted as dangling: reporting a file that cannot be reached as
"missing" would make the whole audit untrustworthy on first run.

With `--audit`, `--json` carries `codeRoot` (the primary root, `null` when none), `codeRootSource`
(`flag`, `own-clone`, `mapping`, `holding-repository` or `none`), `repositoryRoots` (one row per
repository the model names), `resolverWarnings` and `notRunReason`. `notRunReason` is set only when
no repository the model names has a root, so nothing was checked: the audit then reads **not run**,
never "no dangling refs". The text output prints one line per repository naming its root and where
it came from, or why there is none.

On a case-insensitive file system (macOS by default) a `code_ref` whose case differs from the
file's is found and reported `present`; a case-sensitive one (Linux) reports it `missing`.

## Matching is segment-aligned

Comparisons are anchored on `/` boundaries. Querying `src/Cart` does **not** match
`src/CartRule/Query/SearchCartRules.php`. Measured on a 691-ref model, raw substring matching
produced 107 false positives of exactly that shape, and segment matching lost no real match.

Every match row states *why* it matched, so a surprising row can be audited rather than trusted:

| `matchKind` | Meaning |
|---|---|
| `exact` | Identical paths |
| `ref-under-query` | The query is a directory containing the ref |
| `query-under-ref` | The ref is a directory containing the query, which is **broad**: one entity referencing `src/Core/Domain/` makes every file beneath it count as covered. Watch for this kind in the output when a path you expected to be flagged is not |
| `suffix` | Segment-aligned tail match, for refs written relative to a sub-package root (`--no-suffix` disables) |

## Relationship to `bp coverage-check`

`bp` is the **Archally Pro** CLI ([archally.pro](https://archally.pro)), a separate commercial
product, not part of this package. It exposes the same coverage analysis as a verb.

The analysis and the choice of root are the same code: `analyze.mjs` and `code-root.mjs` are
**generated** from the very modules the Pro CLI imports, so neither tool can drift into a different
verdict or a different root. Do not edit either file.

The shared core guarantees the same *analysis*, not the same *corpus*, and the two callers feed it
differently:

| | `bp coverage-check` | this tool |
|---|---|---|
| Reads | the built model (extracted entities) | raw YAML |
| Entity label | `displayId` (`architecture-viewer-frontend`) | the typed `id` (`archally-platform.SVC001`) |
| Type label | the model builder's type (`Operation`) | the containing YAML key (`services`) |
| Corpus | entities the extractors produce | **any** object carrying a `code_refs` array |

The last row is a real difference: on the PrestaShop example this tool audits more refs than `bp`,
because some objects that carry `code_refs`, such as a process, reach `bp`'s entities without them.
For a coverage audit that is the more complete answer: a `code_refs` entry anywhere in the model is
a claim about source, whether or not the graph builder keeps it on a node.
