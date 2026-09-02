# doc-snippet-validate — the YAML in your docs, validated

A worked example in a guide or an agent prompt is not decoration: it is the shape the reader copies.
When the schema moves and the example does not, the documentation starts teaching an invalid model
— and nothing notices, because no validator has ever been pointed at a markdown file.

This is measured, not hypothetical. The flagship example in this project's own modeling prompt had
drifted to **16 schema errors across 5 files**: `layout.slices` as a map instead of an array,
`operations` as a list instead of a map, goals using `name`+`description` instead of
`id`+`statement`+`priority`, an `enforcement` key on a `governed_by` reference. Each one cost every
reader — human or agent — a wasted validation round.

```bash
node tools/doc-snippet-validate/cli.mjs docs/**/*.md --schemas schema/v2.7
node tools/doc-snippet-validate/cli.mjs guide.md --schemas schema/v2.7 --keep   # inspect the extraction
```

| Flag | Effect |
|---|---|
| `--schemas <dir>` | Schema tree to validate against (required) |
| `--validator "<tpl>"` | Command template; `{model}` and `{schemas}` are substituted. Defaults to the zero-build validator |
| `--keep` | Keep the extracted model directory and print its path — the first thing to look at when a failure is puzzling |
| `--json` | Machine-readable report |
| `--optional` | A listed document whose whole tree is absent from this checkout is reported as a skip instead of an error. It forgives a missing *tree*, never a missing file inside a tree that exists — so a mistyped path is still fatal. |

Exit `0` all documents valid · `1` a document failed · `2` usage or IO error.

## What counts as a document

The named blocks in **one markdown file** are materialized together as **one model**, then validated
as a whole. A block is named when the line above it declares a file:

````markdown
#### `.blueprint/repair-jobs/domain.yaml`

```yaml
version: "1.0.0"
...
```
````

That is the convention the modeling prompts already use, so most docs need no change to become
checkable. Guides that organise fences under *conceptual* headings ("Causal chain pattern") can opt
a block in with a marker as its first line, which is stripped before validation:

```yaml
# file: .blueprint/shop/domain.yaml
version: "1.0.0"
...
```
 Validating them together — rather than block by block — is what catches cross-file
errors like a slice named in `blueprint.yaml` that no file provides.

**Unnamed blocks are skipped and counted.** They are fragments, not documents, and validating a
fragment against a whole-document schema produces noise rather than signal. The count is always
printed, so the skip is visible: `9 named block(s), 32 unnamed skipped`.

Two blocks declaring the same path is an error, not a silent overwrite — otherwise only the last
one would ever be validated.

## Why the validator is a parameter

One validator checks a blueprint model: the zero-build `tools/validator`, which reads the schema
version a model declares and applies that version's rules. It is named explicitly rather than
discovered, with `{model}` and `{schemas}` substituted per snippet:

```bash
# the default
--validator "node tools/validator/src/cli.mjs {model} --schemas {schemas}"

# a validator installed somewhere else in the checkout
--validator "node /path/to/validator/cli.mjs --model {model} --schemas {schemas}"
```

A checkout this tool did not lay out may keep its validator anywhere, and guessing would mean
checking a snippet against something other than the schema the guide documents.

## Tests

`extract.test.mjs` covers the association rules — what claims a fence and what does not, since a
block that is silently skipped is an unvalidated example that still teaches.

`rc5-regression.test.mjs` runs two known-bad snippet shapes end to end and asserts they **fail**,
with the corrected forms passing. It needs a schema tree:

```bash
BLUEPRINT_SCHEMAS=schema/v2.7 \
BLUEPRINT_VALIDATOR="node tools/validator/src/cli.mjs {model} --schemas {schemas}" \
  node --test "tools/doc-snippet-validate/*.test.mjs"
```
