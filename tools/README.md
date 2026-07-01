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

## Build

The validator is plain `.mjs` (no build). The other five are TypeScript — compile them once before use:

```bash
npm run build          # builds model-builder, semantic-checker, schema-update, renderer, schema-atlas
```

## Quick reference

```bash
npm run validate:examples    # validate the bundled ecommerce example
npm run check:examples       # semantic-check it
npm run render:ecommerce     # regenerate its .specs/overview.md
```

See the [project README](../README.md) for the full ecosystem overview, and [docs/](../docs/) for the schema reference and modeling guide.

## Licensing

These tools are **not** all under the same license (see [tools/LICENSE](./LICENSE) and the repo-root [LICENSE](../LICENSE) map):

- **`validator`** and **`vscode-blueprint`** → Apache-2.0. Reference conformance and editor tooling for the open format; use freely.
- **`model-builder`, `semantic-checker`, `renderer`, `schema-update`, `schema-atlas`** → [FSL-1.1-ALv2](../LICENSE-FSL). Free for internal use, non-commercial education/research, and professional services — **not** for a Competing Use. Each version converts to Apache-2.0 two years after release.
