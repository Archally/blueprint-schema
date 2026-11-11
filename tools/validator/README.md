# Blueprint validator

Validates a blueprint model: per-file schema conformance, cross-file reference integrity, and gap
warnings. Answers **"is this model legal?"** — not "is it connected?" (that is the semantic checker)
and not "does it say anything?" (that is the quality gate).

```bash
node cli.mjs --model <model-dir> [--schemas <version-root>] [--tracked-register <path>] [--compat]
```

Exit codes: `0` no errors (warnings may exist) · `1` errors · `2` runner failure.

## Layout

| Path | Role |
|---|---|
| `core/` | the rule engine — layout-agnostic, takes a model dir + schema root, returns findings |
| `cli.mjs` | argument parsing, schema-root resolution, output formatting, exit codes |

`core/` is the portable half: it knows nothing about where a checkout puts its schemas. `cli.mjs` is
the half that does, which is why the two are separate.

Dependencies are `yaml`, `ajv` and `ajv-formats` — nothing else. That is a constraint, not an
accident: this validator is the **reference conformance implementation**, so anyone must be able to
run it to check a model against the published schemas without pulling in the rest of the toolchain.
Do not add a dependency on the model builder, the semantic checker, or any other tool here.

## Where schemas come from

Sources are consulted most-specific first. A source that is **declared but unusable stops the run** —
if someone wrote the location down, guessing past it would defeat the point.

| # | Source | Notes |
|---|---|---|
| 1 | `--schemas <path>` | explicit, always wins |
| 2 | `BLUEPRINT_SCHEMAS` | machine-level, useful in CI |
| 3 | `validator.config.json` | `{"schemas": "<path>"}`, resolved **relative to the config file** |
| 4 | layout discovery | `schemas/blueprint/<version>` or `schema/<version>`, walking up from the model, from the validator, then from the working directory; when the model finds a schema outside the validator's own checkout, use the validator's shipped version if available and print a note naming both paths |

Config lives **beside the model** — `.blueprint/validator.config.json`, a sibling of the version
directories — so it travels with the repo it configures and a fresh clone needs no arguments. It is
JSON, not YAML, on purpose: the model walk collects `*.yaml`, and a config file that can be mistaken
for model content is a defect waiting to happen.

`schemas` may point either at a directory *of* versions (`<path>/v2.7`) or at a version root itself.
A consumer repo that holds a model but no schemas points this at a checkout that has them.

**The validator never uses the network.** Its verdict gates commits and CI, so it has to be
reproducible and must not depend on what a host served today. Getting schemas onto the machine —
clone, vendor, or install — is a separate concern from validating with them. When nothing resolves,
it fails with the version it wanted and every location it looked in, rather than skipping files or
fetching anything.

## Schema-version awareness

Behaviour follows the version the **model declares** (`.blueprint/v2.6`, `.blueprint/v2.8`, …), not
the newest version this code knows about. Two consequences:

- **Layer names from every era are mapped.** `rg`, `ui` and `org` are the pre-v2.7 spellings of
  `infrastructure`, `interactions` and `organization`; both spellings resolve, so a v2.4–v2.6 model
  validates against the schemas it was authored for.
- **Rules can differ by version.** From v2.7 only commands and queries need an `exchange` block —
  events are domain facts and are exempt, and `dispatch: in-process` is deliberately
  transport-less. Before v2.7 every operation was expected to carry one, and a v2.6 model is still
  held to that.

A file whose layer is recognised but whose schema is absent produces a **warning naming the type and
the schema it looked for**. It is never skipped in silence — a validator that quietly ignores input
reports success it did not establish.

## A document beside the model, not inside it

A project that stages its changes rather than applying them one at a time keeps them in a register
at `.blueprint/migrations.yaml`, one level above the model directory. Nothing in the model walk
arrives there, so reaching it takes a path:

```bash
node cli.mjs --model <model-dir> --tracked-register <project>/.blueprint/migrations.yaml
```

Findings read like any other, and the report names the register whether or not it could be checked.
That second half is the point: a line that appeared only on success would leave "checked and clean"
and "never looked at" sharing one silence, which is the same reason a skipped file is named rather
than counted.

A schema line with no description of a register says so by name, as a warning, and the model is not
failed for it. The register is reported on its own line and never folded into the validated-file
count, because it is not one of the model's files.

## What takes part in what

**A model is the set of files the model builder loads**, and the validator checks exactly that set.
Which files those are is decided by the builder's own routing table, which this validator runs as a
generated copy (`core/schema-routing.mjs`): `<layer>.yaml` or `.yml` at any depth,
`<name>.<layer>.yaml` (the layer name in any case, a dot-prefixed name included), `migration.yaml`
and `<name>.migration.yaml`, `migrations.yaml`, and the root document `blueprint.yaml`. Every file
of the model is schema-checked, contributes its ids, and has its references resolved; a model file that
fails to parse is an error.

A file outside the model takes no part: it is not schema-checked, its declarations satisfy no
reference and its references are not resolved, because no reader of the model ever sees it. The run
lists it under "not part of the model". Most such files are ordinary (a README beside the model, a
deployment manifest). Three kinds are errors, each naming the file and the fix, because each is a
model file that would otherwise be lost without a word:

- **A name that looks like a model file and is not one**: `<name>-<layer>.yaml`,
  `<name>.blueprint.yaml`, `<name>.migrations.yaml`. The message names the spelling that is read
  (`orders-domain.yaml`: rename it `orders.domain.yaml`). A dot-prefixed name is tool
  configuration and is never reported.
- **A retired file name**: `process.yaml` (and `<name>.process.yaml`) is no longer read; the
  narrative file is `story.yaml`, still read under both of its collection keys, `processes:` and
  `stories:`.
- **A misplaced root document**: a model has one root document, `blueprint.yaml` (or `.yml`) at
  the model root. One below the root, or a second one at the root, is reported; it is still part of
  the model, so it is still checked.

These are cross-reference errors, so `--compat` does not relax them. The model server's
`get_validation` applies the same membership through the same module (`core/file-membership.mjs`),
so the two report the same findings in the same words.

**Which keys hold a reference is read off the schema tree the run validates against**, never
listed: a key is a reference where the schema types it as a metamodel `*_ref`, and it is qualified
by its parent - `owned_by.team` is a `team_ref`, `resource_owner.team` is a free-form name, and the
walk tells them apart. Under a key the schema does not type, a scope-qualified typed id
(`orders.CMD001`) is still resolved, because nothing else is spelled that way; a bare id there is
left alone, since it could be a name. `operation_ref` and `error_ref` also accept `scope:key`
(`orders:placeOrder`), resolved against the entries of the scoped document's `operations` and
`errors` maps - the scope being the one the document declares, else the folder it sits in, which
is the fallback the model loader applies. The models layer declares its ids under `x-model-id`,
and those declarations satisfy a `model_ref` like any `id` does.

`RT###` references point at the resource-type catalog in the schema profiles rather than into the
model, so they are not resolved against model ids.
