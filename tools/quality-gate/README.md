# Blueprint quality gate

Deterministic coverage measurement for the dimensions that no validator enforces:
whether a blueprint **describes itself** well enough for its downstream consumers.

The schema validator answers *"is this legal?"*. The semantic checker answers
*"is this connected?"*. Neither answers *"does this say anything?"* — and that is
precisely where a model degrades without ever going red. A model property with no
`description` is perfectly valid YAML and becomes a bare field in every generated
OpenAPI contract and every viewer that renders it.

The shape this gate measures is named by the schema as of **v2.7.8**:
`design/models.schema.yaml` → `$defs/model_property`. That def is deliberately
all-optional, so it constrains nothing — schema and gate divide the labour cleanly.
The schema says *what a property may contain*; this gate says *how much of it is
actually filled in*. (v2.8 is expected to promote `description` there from optional
to required; when it does, this metric becomes the early-warning signal for that
break rather than a parallel opinion about it.)

**Design premise:** an authoring loop's output floor is set by what its feedback
loop measures. Prose guidance raises the ceiling; only a gate raises the floor.

## Quick start

```bash
# Report (never fails — this is the default)
npm run quality <model-dir>

# Release gate
npm run quality <model-dir> --strict

# Gate only what you just changed — the brownfield PATCH mode
npm run quality <model-dir> --strict --since HEAD~1

# Gate ONE slice as its own unit — the brownfield VERTICAL mode
npm run quality <model-dir> --slice payroll --strict

# Record a slice's current scores as its own ratchet floor
npm run quality <model-dir> --slice payroll --update-baseline

# One entity, field by field: its own id, or the id of a part it owns
npm run quality <model-dir> --entity catalog.CN001
npm run quality <model-dir> --entity CAT813

# Every entity of one file, field by field - the check to run after editing it
npm run quality <model-dir> --file catalog/product.concepts.yaml

# Machine-readable: per-finding records, usable directly as a backfill worklist
npm run quality <model-dir> --json worklist.json

# Read entity types from a named schema tree instead of the one found beside the model
npm run quality <model-dir> --entity BD014 --schemas <schemas-dir>/v2.8
```

The JSON carries, per run, `metrics[]`, `findings[]` (one record per metric and value
that is not covered), `worstFiles[]` and `entities[]`: one record per entity in the
selection, with `entityId`, `name`, `kind`, `file`, `ownedIds` when it owns parts with ids,
`counts` (`fields`, `covered`, `filler`, `missing`) and its `findings` (one per field that
is not covered, naming the metrics that read it). `entityMode` and `fileMode` echo the
selection beside `patchMode` and `sliceMode`. An entity of a kind the structure signals
measure also carries `structure`, and each run carries a `structure` block with one row per
kind; both are described in [Structure](#structure-facts-in-fields-or-only-in-prose).

`--since`, `--slice`, `--entity` and `--file` are the scoping modes and are mutually
exclusive: they scope by git history, by folder, by entity and by file.

The same gate is also a verb on the **Archally Pro** CLI (`bp quality <project>`), which
resolves projects by name and shares this tool's spec and thresholds — see
[archally.pro](https://archally.pro).

Exit codes: `0` clean · `1` threshold or baseline breach under `--strict` · `2`
usage error or invalid configuration. The structure signals never change the exit code.

## The definition-of-done sentence

Both agent harnesses embed this verbatim, so the wording has one source — here:

> **A slice is done when the validator is green, the semantic checker reports no new
> findings, and the quality gate is clean for the files the slice touched
> (`--since <base-ref> --strict`) — or every remaining gap is recorded in
> `.blueprint-quality.yaml` as a deferral with a reason and an expiry date.**

Note what it does *not* say: it never requires the whole model to be clean. On a
brownfield model that bar is unreachable, and an unreachable bar gets switched off.
The slice is accountable for the slice.

| Harness | Trio |
|---|---|
| this repo | `npm run validate <model>` → `npm run check <model>` → `npm run quality <model> --since <ref> --strict` |
| Archally Pro CLI | `bp validate <p>` → `bp check <p>` → `bp quality <p> --since <ref> --strict` |

## What it measures

Every metric resolves each observed item into exactly one of three states:

| State | Meaning |
|---|---|
| **covered** | present and substantive |
| **filler** | present but says nothing — a placeholder, or prose that merely restates the field name |
| **missing** | absent or blank |

`filler` exists because a presence-only check is gameable by construction. An agent
optimizing a red/green loop will write `description: "The criteria field."` and turn
the gate green while the downstream viewer is no better off. Filler counts against a
metric exactly like a missing value, and the report keeps the two apart because they
need different fixes: missing needs authoring, filler needs someone to notice that
the gate was answered rather than the question.

Content rules are deterministic — minimum length, a placeholder denylist, and an
echo check that normalizes case, punctuation, articles and words like "field" before
comparing prose against the name it describes. No model is involved.

## Structure: facts in fields or only in prose

The metrics above ask whether an entity says something. The structure signals ask whether
what it says sits in the fields built for it. They are read beside the metrics and gate
nothing: no threshold, no metric, no effect on the exit code.

| Signal | What it reports |
|---|---|
| **references held only in prose** | ids an entity's `description` (or a rule's `logic`) names that no other field of the same entity names. Each token is resolved against the ids the model declares: first under the entity's own scope (`VR008` written in an `international` rule is `international.VR008`), then exactly, then by its unscoped tail when exactly one declared id ends with it. A token shaped like an id that the model does not declare (a version string, a currency code) is ignored, and so is the entity's own id |
| **fields used** | the fields an entity fills, out of those its schema type makes available. An empty string, list or map is not a field used |
| **description length** | context beside the two, never a score of its own |

Each reference held only in prose is marked with what the schema offers for it: **a field can
hold it** (the field is named, so the fix is to move the id into it) or **the schema has no
field for this** (the entity's type has no field accepting an id of that kind, so the fix is a
schema change, not an edit). Which fields accept which ids is read from the reference patterns
the type's fields reach (`concept_ref`, `rule_ref`, ...).

The available set and the reference fields come from the schema's own `$defs`: each measured
container key (`validation`, `business_decisions`, `kpis`, ...) maps to the type its items are,
so the measure follows the schema without a hand-kept list. `quality-spec.yaml` holds only the
`structure` block: the measured containers, the identity fields (`id`, `name`, `title`, `term`)
and prose fields (`description`, `summary`, `statement`) left out of fields used, and the fields
references are read from. A container two schema files define with different types has no
known available set.

The schema tree is found by walking up from the model, then from this tool's directory, then
from the working directory, trying `schemas/blueprint/v<major.minor>/` and `schema/v<major.minor>/`
for the version the model declares; `BLUEPRINT_SCHEMAS` names a tree to try first. `--schemas
<dir>` names it outright, as a version root or a directory of versions, and a `--schemas` that
holds no schema for the model's version is a usage error (exit 2). Without a schema the
references are still reported and the available set reads as unknown, with the reason.

Where it shows:

- **entity and file mode**: each entity block ends with `fields used: <n> of <available>
  (<fields>); description <n> chars`, then one `held only in prose` line per reference;
- **whole-model, patch and slice mode**: a table with one row per kind (entities, entities with
  references held only in prose, those references, how many are schema gaps, fields used
  median and maximum against the available set, description length median and maximum),
  then the entities holding references only in prose, most first, limited by `--worst`;
- **`--json`**: `entities[].structure` (`kind`, `type`, `fieldsUsed`, `fieldsAvailable`,
  `descriptionLength`, `proseOnlyReferences[]` with `id`, `written`, `in`, `schemaHasField`,
  `fields`) and `runs[].structure` (`schemaRoot`, `schemaSource`, `note`, `kinds[]` with the
  table's counts, the `fieldsUsed.distribution` and a `fieldUse` count per field).

Fields used is read with the entity's sources, never maximised. A field is written when a
source supports it and an empty field stays empty, so a low count on a well-sourced entity is
not a defect, and a high count reached with invented values is worse than prose.

## The three gating mechanisms

One bar does not fit a corpus ranging from a three-file sketch to a 557-file
brownfield model:

| Mechanism | Question it answers | Where it is set |
|---|---|---|
| `threshold` | Is this model good enough to release? | `quality-spec.yaml`, corpus-calibrated |
| `patch_threshold` | Is the work being authored *right now* good enough? | `quality-spec.yaml`, higher than `threshold` |
| `baseline` | Has this model got worse? | `.blueprint-quality.yaml`, ratchets upward only |

The distinction matters most on legacy models. A model at 19% property-description
coverage can never pass an 85% absolute bar, so an absolute-only gate gets deferred
off and stops doing anything. With `--since`, that same model is still required to
write its *next* property properly, and the ratchet stops the overall number sliding.

## Scoping modes: patch, slice, entity and file

A brownfield model is not remediated in one pass — it is enriched one architectural
**slice** at a time, and authored one entity and one file at a time. The gate offers
four ways to scope a run below the whole model:

| Mode | Flag | Scopes by | Bar it applies | Ratchet |
|---|---|---|---|---|
| **patch** | `--since <ref>` | files changed since a git ref | `patch_threshold` (higher — new work has no legacy excuse) | off (a changed-file subset is not a whole-model claim) |
| **slice** | `--slice <name>` | first path segment (`payroll/`, `recruitment/`, …) | `threshold` (the slice measured as its own steady-state unit) | the slice's own baseline |
| **entity** | `--entity <id>` | one entity | `patch_threshold` (the entity is work in progress) | off |
| **file** | `--file <path>` | every entity of one file | `patch_threshold` | off |

A slice is the first path segment under the model root; files that sit directly in
the root belong to a synthetic `(root)` slice. A `--slice` that selects nothing
measurable — a misspelled name, or a folder holding no scorable YAML — is a usage
error (exit 2) that lists the slices which would have worked. A gate cannot pass over
zero files: that verdict would be green and meaningless. Slice mode is what makes a *vertical*
remediation plan measurable: `--slice payroll --strict` answers "is the payroll
slice at its bar yet?" and `--slice payroll --update-baseline` records payroll's own
floor so it ratchets independently of every other slice.

Entity and file mode answer the author's question while editing: "does what I just wrote
say enough?". Their report leads with one block per entity: its id and name, its kind,
its file, and one row per authored field marked `ok`, `FILL` or `MISS` with the reason
a filler value was condemned. The metric table follows, showing only the metrics that saw
data in the selection.

- `--entity` takes the entity's own id (`catalog.CN001`, `MDL800`) or the id of a part it
  owns (`CAT813`, a concept attribute). A part selects its owner's block, and its rows
  are marked `>`. An id without its scope prefix (`CN001`) is accepted when exactly one
  entity carries it; when several do, the run refuses and lists them.
- `--file` takes a path relative to the model root (`admin/models.yaml`) or to the working
  directory, so the path an editor reports works as it is.
- A selection that names nothing refuses with exit 2 and names candidates: ids sharing
  the requested prefix, or files in the same folder. A file that exists but holds no
  entity the gate observes refuses the same way.
- Both select inside one model, so they take exactly one model root, and neither combines
  with `--update-baseline`: a ratchet floor is a claim about a whole model or slice.

**What an entity is.** A property rolls up to the model that declares it, an attribute
to the concept that owns it, a story step's note to its activity; everything else with a
typed id is an entity of its own. Some fields are read by two metrics (an event's
description by the operation metric and the event metric; an enum property's description
by the property metric and the enum-property metric). Each metric still counts it, since
each is its own lens, but an entity block shows it once and names both metrics, with the
worse of the two verdicts. The whole-model, patch and slice reports list the **worst
entities** (most missing and filler fields) beside the worst files, both limited by
`--worst`.

## Configuration

Thresholds ship in `quality-spec.yaml`, calibrated from the whole in-repo corpus
rather than from one reference model — a bar set to one model's own score passes
that model by construction and proves nothing about achievability elsewhere. Every
threshold records its calibration source and sample size. Metrics whose corpus
sample is too thin or too skewed carry `threshold: null`: they still report and
still ratchet, but they do not gate.

Per-project settings live in `.blueprint-quality.yaml`, discovered in the model root
or up to three directories above it:

```yaml
thresholds:
  model.property.description: 0.70   # this project holds itself to a higher bar

baseline:                            # written by --update-baseline
  model.property.description: 0.842  # flat: the whole-model ratchet
  slices:                            # written by --update-baseline --slice <name>
    payroll:                         # per-slice ratchet — payroll never gets worse
      model.property.description: 0.61
    recruitment:
      model.property.description: 0.44

deferrals:                           # global — apply in every scope
  - metric: domain.command.exchange
    reason: >-
      No wire bindings authored yet; backfill tracked in MIG012.
    expires: 2026-10-31

slice_deferrals:                     # scoped — apply only in that slice's run
  payroll:
    - metric: model.property.description
      reason: >-
        Payroll schemas not yet enriched; scheduled in the vertical plan.
      expires: 2026-12-31
```

The flat `baseline` map is the whole-model ratchet; `baseline.slices.<name>` holds a
slice's own floor, consulted only under `--slice <name>`. The two are independent
claims and never clobber each other — a whole-model `--update-baseline` leaves the
`slices` block untouched, and a `--slice … --update-baseline` writes only that slice.

Deferrals work the same way in two tiers. A `deferrals` entry suppresses a
below-threshold metric in **every** scope; a `slice_deferrals.<name>` entry
suppresses it **only** in that slice's run. That is what lets a vertical plan keep
every slice's gate green *honestly* while it works through them one at a time: an
un-enriched slice carries its own expiring deferral, and enriching the slice (so it
meets the real threshold) is what removes it. A slice-scoped deferral is validated
exactly like a global one — reason and expiry are mandatory. The ratchet is not an
escape from a threshold; a deferral is the only sanctioned way to be green while
genuinely below the bar.

A deferral **must** carry both a `reason` and an `expires` date — a deferral without
a reason is just a disabled check, and one without an expiry becomes permanent.
Missing either is a configuration error (exit 2). Past its expiry the tool warns
loudly but does not fail, mirroring how evidence freshness is handled elsewhere in
this repo.

## Version-agnostic by design

This tool is **not** tied to a schema version directory. Version directories get forked
whole when a new schema minor opens, and a tool placed inside one would fork with it —
producing two copies that drift apart. Instead, each metric declares which schema minor
lines it applies to, and the tool runs against any of them.

The model root always arrives as an argument. Two things resolve relative to the tool's own
location: the default spec, and, when the model's own surroundings hold no schema tree, the
schema the structure signals read, looked up by the model's declared version. That is what
lets one copy serve every version.

## Files

| File | Role |
|---|---|
| `cli.mjs` | argument parsing, orchestration, exit codes |
| `collect.mjs` | blueprint YAML → observations (knows blueprint shapes) |
| `heuristics.mjs` | covered / filler / missing classification |
| `evaluate.mjs` | observations + spec + config → scores, findings, breaches |
| `report.mjs` | text rendering |
| `git-changes.mjs` | `--since` changed-file resolution |
| `slice.mjs` | `--slice` scoping — derives a file's slice from its path |
| `entities.mjs` | `--entity` and `--file` selection; the per-entity rollup |
| `structure.mjs` | the structure signals: schema lookup, references held only in prose, fields used |
| `config.mjs` | spec + project-config loading, baseline writing (flat + per-slice) |
| `quality-spec.yaml` | metric definitions, content rules, calibrated thresholds |

Adding a **threshold, content rule or deferral** is a YAML edit. Teaching the tool a
**new blueprint shape** is a code change in `collect.mjs`. That seam is deliberate.

Unrecognised typed-id entities fall through to a catch-all `entity.description`
metric rather than vanishing — when the schema gains an entity kind, it lands there
instead of silently dropping out of the gate. A rising count there is the signal to
add a real metric for it. Anything a specific metric already reads is not read again
by the catch-all: a concept attribute with a typed id is measured once, by the
concept-attribute metrics, and reports under its concept. The catch-all reports an
entity's kind as the key it was found under (`goals`, `activities`).

## Tests

```bash
node --test <this-directory>/*.test.mjs
```

Zero-config `node --test`, so the tool carries no test-runner configuration. Fixtures are
modelled on real observed failure shapes — undescribed `one_of` counterpart events,
actors documented via `summary` rather than `description`, map-form collections,
scope-prefixed ids — plus false-positive guards built from genuinely terse
descriptions, so the heuristics cannot quietly become their own noise source.
