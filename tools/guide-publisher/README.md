# guide-publisher

Builds the **[Blueprint Handoff Atlas](../../docs/handoff-guides/markdown/)** into two publication
surfaces:

- previewable HTML in `docs/handoff-guides/markdown/.build/`
- committed PDFs in `docs/handoff-guides/pdf/`

This tool is intentionally separate from the schema-derived `schema-atlas`: it serves
**non-technical handoff guidance**, not schema reference.

## Commands

````bash
npm run build          # compile the tool
npm run guides:build   # render preview HTML + build manifest
npm run guides:pdf     # render preview HTML + committed PDFs + PDF manifest
npm run guides:check   # verify PDF manifest, file set, and local links are current
````

CLI (`blueprint-guides <build|pdf|check> [options]`):

| Option | Default | Meaning |
| --- | --- | --- |
| `--repo-root <dir>` | cwd | Repository root |
| `--source <dir>` | `docs/handoff-guides/markdown` | Source Markdown directory |
| `--build <dir>` | `docs/handoff-guides/markdown/.build` | Preview HTML output directory |
| `--pdf <dir>` | `docs/handoff-guides/pdf` | PDF output directory |
| `--browser <path>` | auto-detect | Browser executable for PDF rendering |

The tool auto-detects a local Chrome/Edge install on Windows, or you can set
`BLUEPRINT_GUIDES_BROWSER` / `--browser` explicitly.

## Output model

- **Source of truth:** `docs/handoff-guides/markdown/**/*.md`
- **Preview output:** `.build/*.html` + `.build/manifest.json`
- **Committed output:** `pdf/*.pdf` + `pdf/manifest.json`

The PDF manifest stores source and rendered-HTML hashes, which makes `guides:check` reliable even
though browser-generated PDF bytes are not stable enough for a raw byte compare.

## Validation behavior

- broken local Markdown links → generation failure
- missing/stale `pdf/manifest.json` → `guides:check` failure
- missing/orphan PDF files → `guides:check` failure

## Contributor workflow

1. edit `docs/handoff-guides/markdown/**/*.md`
2. run `npm run guides:pdf`
3. commit the changed Markdown, generated PDFs, and `pdf/manifest.json`
4. CI or local `npm run guides:check` verifies the export set is up to date