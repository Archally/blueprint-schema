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
| `--schemas`, `-s` | Schema version root directory | Auto-detected from package |
| `--compat`, `-c` | Demote schema errors to warnings | `false` |

A positional argument (without flag) is treated as the model path.

## Checks Performed

**Schema validation** (Ajv, JSON Schema draft-2020-12):
- Per-file validation against the matching schema type (detected from filename)
- All 20 schema types supported

**Cross-reference integrity:**
- Every typed ID reference (`CN001`, `CMD001`, etc.) must resolve to an entity defined somewhere in the model
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
