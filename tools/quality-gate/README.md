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

# Gate only what you just changed — the brownfield mode
npm run quality <model-dir> --strict --since HEAD~1

# Machine-readable: per-finding records, usable directly as a backfill worklist
npm run quality <model-dir> --json worklist.json
```

The same gate is also a verb on the **Archally Pro** CLI (`bp quality <project>`), which
resolves projects by name and shares this tool's spec and thresholds — see
[archally.pro](https://archally.pro).

Exit codes: `0` clean · `1` threshold or baseline breach under `--strict` · `2`
usage error or invalid configuration.

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
  model.property.description: 0.842

deferrals:
  - metric: domain.command.exchange
    reason: >-
      No wire bindings authored yet; backfill tracked in MIG012.
    expires: 2026-10-31
```

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

Nothing resolves relative to the tool's own location except the default spec; the model
root always arrives as an argument. That is what lets one copy serve every version.

## Files

| File | Role |
|---|---|
| `cli.mjs` | argument parsing, orchestration, exit codes |
| `collect.mjs` | blueprint YAML → observations (knows blueprint shapes) |
| `heuristics.mjs` | covered / filler / missing classification |
| `evaluate.mjs` | observations + spec + config → scores, findings, breaches |
| `report.mjs` | text rendering |
| `git-changes.mjs` | `--since` changed-file resolution |
| `config.mjs` | spec + project-config loading, baseline writing |
| `quality-spec.yaml` | metric definitions, content rules, calibrated thresholds |

Adding a **threshold, content rule or deferral** is a YAML edit. Teaching the tool a
**new blueprint shape** is a code change in `collect.mjs`. That seam is deliberate.

Unrecognised typed-id entities fall through to a catch-all `entity.description`
metric rather than vanishing — when the schema gains an entity kind, it lands there
instead of silently dropping out of the gate. A rising count there is the signal to
add a real metric for it.

## Tests

```bash
node --test <this-directory>/*.test.mjs
```

Zero-config `node --test`, so the tool carries no test-runner configuration. Fixtures are
modelled on real observed failure shapes — undescribed `one_of` counterpart events,
actors documented via `summary` rather than `description`, map-form collections,
scope-prefixed ids — plus false-positive guards built from genuinely terse
descriptions, so the heuristics cannot quietly become their own noise source.
