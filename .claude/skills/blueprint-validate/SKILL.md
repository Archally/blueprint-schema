---
name: blueprint-validate
description: >
  Validate blueprint YAML against the Archally Blueprint Schema using the schema repository's local
  validator, semantic checker and quality gate, and interpret / fix their output. Use after editing or adding any `.blueprint/**` file, or
  when the user asks to "validate the blueprint", "check the YAML", or "fix validation errors".
---

# Blueprint validation (public repo, local validator)

The schema repository ships a **deterministic validator** - plain `.mjs`, no compile step, no cloud,
no paid tools. It is the single source of truth for "is this model valid?". Treat a passing run like a
passing test: run it after every meaningful batch of edits, and never call a slice done until it passes.

## Bind the schema root and the model

All three tools are npm scripts of the public schema repository, so every run names two absolute paths:

- **`SCHEMA_ROOT`** - the schema repository's root. Resolve it in this order and stop at the first that
  applies: a path the user gave in this session; the `BLUEPRINT_SCHEMA_ROOT` environment variable; the
  current repository root when it is the schema repository itself. Otherwise ask for the path to their
  clone. Never download it and never guess a sibling directory. Confirm it: its `package.json` is named
  `@archally/blueprint-schema` and it has a `schema/` directory.
- **`MODEL_DIR`** - the model's `.blueprint/vX.Y` directory. When the user names none, list the
  `.blueprint/v*` directories in the project and accept the result only when there is exactly one;
  otherwise ask which one is meant.

Prerequisites, once per schema root and only with the user's consent: `npm --prefix "$SCHEMA_ROOT" install`
(fetches the repository's npm dependencies), then `npm --prefix "$SCHEMA_ROOT" run build` (compiles the
semantic checker and the other TypeScript tools locally). Both need Node 20 or later. The validator and
the quality gate run after the install alone.

## How to run

```bash
npm --prefix "$SCHEMA_ROOT" run validate -- "$MODEL_DIR" --schemas "$SCHEMA_ROOT/schema"
npm --prefix "$SCHEMA_ROOT" run check    -- "$MODEL_DIR"
npm --prefix "$SCHEMA_ROOT" run quality  -- "$MODEL_DIR"
```

- Paths must be **absolute**: `npm --prefix` runs each script from the schema root, so a relative path
  resolves there, not in your project. The `--` keeps tool flags such as `--json` away from npm.
- `--schemas "$SCHEMA_ROOT/schema"` lets the validator pick the version from the model path; its
  `Schemas:` line names the version it used, and its `Files:` line must report more than zero files.
- The checker reads `.blueprint-lint.yaml` from the working directory, which under `npm --prefix` is
  the schema root. Pass a project's own file explicitly:
  `--config "$PROJECT_ROOT/.blueprint-lint.yaml"`.
- The quality gate finds `.blueprint-quality.yaml` beside or above the model on its own, and
  `--since <ref>` reads git history in the repository that holds the model.

Inside the schema repository, the examples make a quick smoke test:

```bash
npm run validate -- examples/prestashop/.blueprint/v2.8 --schemas schema
npm run validate -- examples/ecommerce/.blueprint/v2.6 --schemas schema
```

## Four kinds of result

Keep them apart; only the first three are about the model.

| Kind | Signal | Act |
|---|---|---|
| Schema or reference error | validator exit 1 | Fix the root cause (below) |
| Checker finding | checker `FAILED`, exit 1 (error findings); `PASSED` with warnings is a pass | Fix or explain each |
| Quality gap | quality report; exit 1 only under `--strict` | Author, rewrite filler, or defer with reason and expiry |
| Missing prerequisite or runner failure | validator exit 2; checker exit 2 (missing `--config` file); quality exit 2 (bad arguments, unreadable config, unparsable model file); npm `ENOENT`; checker `Cannot find module .../dist/cli.js` (npm reports exit 1, so read the message) | Fix the setup: schema root, install, build. Not a model defect |

## Reading the output

- **`PASSED` / exit 0** - the model is valid. **Warnings are allowed** and expected. A warning like
  *"Operation … has no exchange block"* is a **depth hint** (this operation isn't wired for a generator
  yet), not a defect. Don't chase warnings to zero unless the user wants that depth.
- **Exit 1** - a **schema error** (a field violates its JSON Schema) or a **reference error**
  (an ID points at something that doesn't exist). These must be fixed before moving on.
- **Exit 2** - the run itself failed (no schemas found, unreadable configuration). Fix the setup.

## Fix the root cause, never silence it

1. **Read the message** - it names the file, the entity/ID, and the problem.
2. **Reference error** (`… unknown ref`, `entity not found`): trace the reference. Either correct the
   target ID (typo, wrong slice prefix) or **add the missing entity**. Cross-slice refs need the
   `{slice}.{PREFIX}{NNN}` form (`orders.CN001`).
3. **Schema error** (wrong type, unknown property, failed enum/pattern): open the matching schema file
   under `schema/v2.8/**` (e.g. `schema/v2.8/design/domain.schema.yaml`) and align the YAML to the
   declared shape. Check enum casing (`kebab-case`) and property casing (`snake_case`).
4. **Never delete content to make an error disappear.** If real domain knowledge doesn't fit the schema,
   surface it to the user - the fix is to model it correctly, not to drop it.
5. **Re-run** the validator until exit 0.

## Consistency checks the validator enforces

- Every typed reference resolves to an existing ID (within the slice, or via `{slice}.` prefix).
- Entity IDs are unique within their scope; ID patterns match their prefix (`CN\d{3,}`, `CMD\d{3,}`, …).
- Each file conforms to the JSON Schema for its layer.
- **Bounded-context resolvability** has two severities. A `bounded_context_ref` /
  `dependency.bounded_context_ref` pointing at an unknown `BC###` is dangling and an **error**, as is any
  typed reference to an id nothing declares. An operation that no service contract `expose`s/`send`s (and
  the name/scope fallback doesn't catch) is *unbound* and a **warning**; so is a competency question with
  no `bounded_context_ref` context. The **semantic checker**
  (`npm run check`) surfaces unbound operations/questions too. Don't "fix" an unbound operation by adding a
  domain-file ownership ref (there is none for operations) - wire it into a service contract's
  `expose`/`send`.

## Reading the quality gate

The quality gate scores **self-description coverage** - the dimension neither of the other two tools
touches. A model can be fully valid, fully connected, and still be useless to the OpenAPI generator
that consumes it, because its properties have no descriptions.

Its central distinction:

| Result | Meaning | Fix |
|---|---|---|
| **covered** | Present and substantive | - |
| **filler** | Present but says nothing - a placeholder, or prose that just restates the field name | Rewrite it. Filler counts against you exactly like a missing value |
| **missing** | Absent or blank | Author it |

- **Default run never fails** (exit 0). It is a report; read it and act on the worst files.
- **`--strict`** exits 1 on a threshold or baseline breach. Use it in CI and before calling a slice done.
- **`--since <ref>`** scores only entities in files changed since that git ref, against a *higher* bar.
  This is the mode to use on an existing model: the whole-model score may be far below threshold and
  irreducible today, but the slice you just wrote has no such excuse.
- **`--json`** emits per-finding records (file, entity, subject, status, reason) - a ready-made backfill
  worklist.

**The definition of done for a slice:**

> Validator green, semantic checker reporting no new findings, and the quality gate clean for the files
> the slice touched (`--since <base-ref> --strict`) - or every remaining gap recorded in
> `.blueprint-quality.yaml` as a deferral with a reason and an expiry date.

### Deferring honestly

When a gap is real but out of scope right now, record it rather than leaving the gate red:

```yaml
# .blueprint-quality.yaml
deferrals:
  - metric: model.property.example
    reason: >-
      Payload examples need real sample data from the integration team; tracked separately.
    expires: 2026-10-31
```

Both `reason` and `expires` are **mandatory** - a deferral without a reason is just a disabled check,
and one without an expiry becomes permanent. Omitting either is a configuration error (exit 2).

**Do not** resolve a red gate by lowering a threshold in the shared spec. Thresholds are calibrated
across many models; a deferral is local, dated, and visible, which is exactly what a temporary
exception should be.
