# Tools

Reference tooling that ships with the schema. All are **version-agnostic** — point them at a `.blueprint/v{N}/` model and pass `--schemas schema/v{N}` where relevant. Each tool has its own README with full options.

| Tool | What it does | Command |
| --- | --- | --- |
| [**validator**](./validator/) | Schema validation (Ajv, draft 2020-12) + cross-file reference integrity + gap-analysis warnings. Zero build — runs directly with Node. | `npx @archally/blueprint-schema validate <dir>` · bin `blueprint-validate` |
| [**model-builder**](./model-builder/) | Loads the YAML files and builds a typed in-memory graph of entities and relations — the foundation other tools consume. Library + CLI (`model.json`). | `blueprint-model <dir> --output model.json` |
| [**semantic-checker**](./semantic-checker/) | Catches modeling issues schema validation can't — orphan entities, missing causal links, untested rules. Configurable rule engine (`.blueprint-lint.yaml`). | `blueprint-check <dir>` |
| [**renderer**](./renderer/) | Example blueprint projection viewer. Generates a markdown report with embedded Mermaid diagrams from a model (the `.specs/overview.md` in each example). | `blueprint-render <dir> -o overview.md` |
| [**schema-update**](./schema-update/) | Automated schema-version migration (e.g. `v2.6 → v2.7`) with `--dry-run`, applied safely. | `blueprint-schema-update <dir> --dry-run` |
| [**schema-atlas**](./schema-atlas/) | Generates the human-readable [Schema Atlas](../docs/schema-atlas/) — layer map, entity catalog, relationships, and a structural changelog — from schema truth, with drift detection. | `npm run atlas` · `npm run atlas:check` · bin `blueprint-atlas` |
| [**guide-publisher**](./guide-publisher/) | Builds preview HTML and committed PDFs for the non-technical [Blueprint Handoff Atlas](../docs/handoff-guides/markdown/) guide family, with manifest-based drift checks. | `npm run guides:build` · `npm run guides:pdf` · `npm run guides:check` · bin `blueprint-guides` |
| [**quality-gate**](./quality-gate/) | Measures whether the model *describes itself* — the coverage dimensions no validator enforces. Ratchets against a committed baseline. Zero build. | `npm run quality <dir> --strict` |
| [**next-id**](./next-id/) | Allocates the next free typed id (`SVC029`, `customers.CMD012`) across the whole model, so ids are never guessed or reused. Zero build. | `npm run next-id SVC --model <dir>` · bin `blueprint-next-id` |
| [**coverage-check**](./coverage-check/) | Both drift directions between `code_refs` and the source tree — code changed with no entity, and refs pointing at files that are gone. Zero build. | `npm run coverage-check <paths> --model <dir> --audit` · bin `blueprint-coverage-check` |
| [**entity-query**](./entity-query/) | Search the model before minting a new entity — text, type, layer and tag, ranked by where the hit landed. Reads a built `model.json`. | `npm run entity-query model.json --text order` · bin `blueprint-entity-query` |
| [**model-query**](./model-query/) | Reuse audit over a built `model.json` — recurring finding themes, orphan risks, duplicate archetypes, shared-kernel concepts. | `node tools/model-query/src/cli.ts <model.json>` |

## Build

The validator, `quality-gate`, `next-id` and `coverage-check` are plain `.mjs` — no build, no toolchain,
runnable on a bare Node install. The other six are TypeScript — compile them once before use:

```bash
npm run build          # builds model-builder, semantic-checker, schema-update, renderer, schema-atlas, guide-publisher
```

## Quick reference

```bash
npm run validate:examples        # validate the bundled ecommerce example
npm run check:examples           # semantic-check it
npm run render:ecommerce         # regenerate its .specs/overview.md
npm run quality:examples         # self-description coverage of the prestashop example
npm run coverage-check:examples  # code_refs coverage for two paths, one modelled and one not
```

The deterministic sequence when authoring: **validate** (is it legal?) → **check** (is it connected?)
→ **quality** (does it say anything?) → **coverage-check** (does it still match the code?).

See the [project README](../README.md) for the full ecosystem overview, and [docs/](../docs/) for the schema reference and modeling guide.

## Licensing

These tools are **not** all under the same license (see [tools/LICENSE](./LICENSE) and the repo-root [LICENSE](../LICENSE) map):

- **`validator`** and **`vscode-blueprint`** → Apache-2.0. Reference conformance and editor tooling for the open format; use freely.
- **`model-builder`, `semantic-checker`, `renderer`, `schema-update`, `schema-atlas`** → [FSL-1.1-ALv2](../LICENSE-FSL). Free for internal use, non-commercial education/research, and professional services — **not** for a Competing Use. Each version converts to Apache-2.0 two years after release.
