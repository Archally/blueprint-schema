# Blueprint Validator

Standalone validator for Archally Blueprint YAML files. Performs schema validation, cross-file reference integrity checks, and gap analysis.

## Usage

```bash
# From repo root
node tools/validator/src/validate-blueprint.mjs <blueprint-dir>

# Via npm script
npm run validate:examples

# Via npx (after npm install)
npx @archally/blueprint-schema validate .blueprint/v2.7
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--model`, `-m` | Blueprint directory to validate | `.blueprint/v2.7` |
| `--schemas`, `-s` | Schema version root directory | Resolved — see below |
| `--compat`, `-c` | Demote schema errors to warnings | `false` |

A positional argument (without flag) is treated as the model path.

## Where schemas come from

Sources are consulted most-specific first. A source that is **declared but unusable stops the run**
rather than falling through to the next one.

| # | Source | Notes |
|---|--------|-------|
| 1 | `--schemas <path>` | explicit, always wins |
| 2 | `BLUEPRINT_SCHEMAS` | environment variable, useful in CI |
| 3 | `validator.config.json` | `{"schemas": "<path>"}`, resolved **relative to the config file** |
| 4 | discovery | `schema/<version>` (or `schemas/blueprint/<version>`), searched from the model, then from this tool, then from the working directory |

Config lives beside the model — `.blueprint/validator.config.json`, a sibling of the version
directories — so it travels with the repo it configures. `schemas` may point either at a directory
*of* versions (`<path>/v2.7`) or at a version root itself. A model held in a repository without
schemas points this at a checkout that has them.

**Schemas are never downloaded.** This command's verdict gates commits and CI, so it must be
reproducible offline and must not depend on what a host serves. When nothing resolves, it exits `2`
naming the version it wanted and every location it searched.

## Checks Performed

**Schema validation** (Ajv, JSON Schema draft-2020-12):
- Per-file validation against the matching schema type (detected from filename)
- All 23 schema types supported, including the pre-v2.7 layer names (`ui`, `rg`, `org` — renamed to
  `interactions`, `infrastructure`, `organization` at v2.7), so a model declaring v2.4–v2.6 is
  validated against the schemas it was authored for
- A file whose layer is recognised but whose schema is absent is reported, never skipped in silence

**Cross-reference integrity:**
- Every typed ID reference (`CN001`, `CMD001`, etc.) must resolve to an entity defined somewhere in the model
- Which keys hold a reference is read off the schema tree in use, qualified by parent: `owned_by.team` is a `team_ref`, `resource_owner.team` is a free-form name
- A scope-qualified id (`orders.CMD001`) is resolved wherever it appears, typed key or not; a bare id under an untyped key is left alone
- Operation and error references also accept `scope:key` (`orders:placeOrder`), resolved against the scoped document's `operations` / `errors` map entries
- `x-model-id` declarations satisfy `model_ref` references
- Reports missing references with location

**Gap warnings** (non-blocking):
- Operations without exchange blocks
- Services without contracts blocks
- Duplicate entity IDs

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Passed (may have warnings) |
| 1 | Failed (schema errors or cross-reference errors) |
| 2 | Runner error (missing directory, parse failure) |
