# Archally Blueprint Navigation (VS Code)

Go-to-definition, hover and model diagnostics for **Archally blueprint IDs** across `.blueprint/**` YAML files.

A blueprint references entities by typed id - `billing.CMD012`, `orders.EVT006`, a bare root risk `R005`,
a migration `MIG003`, an attribute `CAT1200`. The JSON Schema (via `redhat.vscode-yaml`) validates an id's
**shape** but not **where it is defined**, so VS Code can't natively jump to or preview it. This extension closes
that gap.

## Features

- **Duplicate IDs** underline every declaration, including declarations in closed sibling files.
  The Problems panel links to every other occurrence with a model-relative file and line.
- **Missing references** underline the reference value or map key that has no declaration.
  Diagnostics use the same reference rules as the Blueprint conformance validator, including
  its scoped IDs and permitted redeclarations. Errors use the editor's native theme colours.

- **Go to Definition** (`F12` / `Ctrl`+click) on any id → jumps to its `id:` declaration, wherever in the
  workspace it lives (the loader merges files by suffix, so a referenced id is often in another file).
- **Hover** → on an id, shows the entity's kind/name + summary and the **source file:line**, with a
  click-to-open link. When an id is declared in more than one model, each row also names its model
  root. Navigation spans the workspace; diagnostics use each model independently. On a `code_ref`
  path, the hover shows where it resolves (local file or host URL), its `role` /
  `description`, and a one-line hint when it resolves to nothing.
- Indexes both block (`- id: orders.CMD001`) and inline (`{ id: CAT1200, ... }`) declarations.
- **Highlight known ids** with a distinct color/style (decoration-based, so it's the same on **any theme**). Only ids
  that are actually *declared* somewhere get coloured - **canary yellow** by default (`archallyBlueprint.idForeground`) -
  so a mistyped or unknown reference stays un-coloured, an easy correctness signal. Configurable color +
  weight/style/underline. Note: the editor font *family* can't be changed per token - only color/weight/style/underline.
- **Open `code_refs`** (`Ctrl`+click) on a `code_refs[].path` → opens that source file - the **local clone**
  when you've mapped its repo in `archallyBlueprint.codeRef.localRoots` and the file exists on disk, otherwise
  the file on its **git host** (GitHub / GitLab / Bitbucket), built from the `repository` / `repositories`
  block in the owning `blueprint.yaml`. Handles same-repo paths and cross-repo `org/repo#path` refs; set the
  preference with `archallyBlueprint.codeRef.openBehavior` (`localThenBrowser` default / `browser` / `local`).
  Append `#L194` or `#L194-L210` to locate a line or range, for example
  `src/Order.php#L194` or `acme/orders#src/Order.php#L194-L210`. A terminal `#Lstart[-Lend]`
  is reserved for navigation; line numbers are positive integers and a range ends at or after its start.
  Local files open at the first line using VS Code's file URI selection. GitHub links retain the range;
  GitLab and Bitbucket links open at its first line. These locations are an extension convention;
  the Blueprint v2.8 schema has no structured line or symbol field. Descriptions remain prose.
  `code_ref` paths are shown in a **distinct link colour** (link-blue by default,
  `archallyBlueprint.codeRefForeground`) so they read as clickable and don't blend with the canary-yellow IDs.
- **Open evidence & URL references** (`Ctrl`+click) → any `http(s)://` URL anywhere in a `.blueprint` YAML
  (evidence `source`, issue trackers, doc links) opens in the browser; an `evidence[].source` that is a
  repo-relative path opens the local workspace file. Shares the code_ref link colour.
- Re-indexes on save / file change; **Archally Blueprint: Re-index IDs** command to rebuild on demand.

It complements `redhat.vscode-yaml` (schema validation + autocomplete + hover on property *keys*) - install both.

## Install / run (dev)

```bash
# Open the extension source folder first.
npm install
npm run compile      # type-check and bundle
npm run watch        # rebuild bundles when sources change
npm run type-check   # check types without emitting files
```

Then press **F5** in VS Code (with this folder open) to launch an Extension Development Host, open a workspace
that contains a `.blueprint/` tree, and Ctrl+click an id like `orders.EVT006`.

To package a `.vsix` for normal installation:

```bash
npm run package    # wraps `vsce package` - see below for why this is not a bare `npx @vscode/vsce package`
code --install-extension archally-blueprint-navigation-<version>.vsix
cursor --install-extension archally-blueprint-navigation-<version>.vsix   # if the Cursor CLI is on PATH
```

`npm run package` builds the extension and schema, then packages from an isolated temporary
folder. Use this command for both development checkouts and exported source distributions.
The VSIX includes the validator, YAML parser, source maps and license notices. Runtime validation
works offline without a source checkout. Building from source requires the accompanying Blueprint
v2.8 schema and Apache validator sources; the build reports an error if either is unavailable.

The VSIX also includes `editor-icon-kit/material-icon-theme.settings.jsonc`. To opt in to its
Blueprint, contract, and manifest recipe icons, install and activate Material Icon Theme, then merge
the kit's association entries into the project's `.vscode/settings.json` or a `.code-workspace`
`settings` object. Preserve unrelated settings and existing associations. If an existing key has a
different icon, decide which value to keep before editing it. Installing this extension alone does
not activate Material or apply the kit. The kit uses exact recipe names; dated JSON delivery records
are excluded. A film recipe named `render.manifest.yaml` uses the same icon as any other file with
that basename. The canonical source is `scripts/editor-icon-table.mjs` in the source repository;
`npm run editor-icons:generate` updates the kit and workspace block together.

## Schema and validation coverage

This extension bundles the Archally Blueprint Schema and contributes it to `redhat.vscode-yaml`
(`contributes.yamlValidation`), so completion and validation work in any workspace that has a
`.blueprint/**` YAML file - no per-repository `yaml.schemas` configuration required. The bundled
tree is copied in at packaging time (`sync-schema.mjs`, run by `vscode:prepublish`), so it is fixed
per release rather than read from wherever the workspace happens to be.

- **Schema line carried by this build: v2.8.**
- 21 blueprint document kinds are contributed: `arch`, `blueprint`, `capability`, `concepts`,
  `decisions`, `domain`, `dynamics`, `infrastructure`, `interactions`, `leverage`, `migration`,
  `migrations`, `models`, `motivation`, `organization`, `quality`, `roadmap`, `rules`, `story`,
  `test-cases`, `value-stream`.
- A schema is bound to exactly the files that form a model: `<layer>.yaml` and
  `<topic>.<layer>.yaml` (and `.yml`), the root document `blueprint.yaml` by that name only, and
  `migration.yaml`, `<name>.migration.yaml` and `migrations.yaml`. The narrative file is
  `story.yaml`; `process.yaml` is not a model file name and gets no schema. A file outside the model
  (`orders.blueprint.yaml`, `orders-domain.yaml`) gets no schema here, and validating the model
  reports it.
- `metamodel.schema.yaml` is deliberately not contributed. It is the shared type-definition file
  the other schemas reference (`$ref: "../metamodel.schema.yaml#/..."`), not a document a project
  authors - a workspace never contains a file that should validate against it, so there is no glob
  to contribute.

### Model diagnostics

Diagnostics cover classified `.yaml` and `.yml` model files under the nearest `.blueprint/vN`
or `.blueprint/vN.N` directory. Separate projects and version directories have separate ID spaces.
Open unsaved buffers override disk content, including inactive editors; closed siblings also
participate. Activation, open, save, close, file changes, workspace changes and re-index refresh
findings. Unsaved edits refresh after a configurable 300 ms delay; saves refresh immediately.

Only v2.8 is bundled for diagnostics. Other versions show a visible unavailable-schema notice
unless `diagnostics.schemaRoot` supplies their full local schema tree. An explicit
`diagnostics.schemaVersion` wins; otherwise a precise version directory wins over `schemaVersion`
in `blueprint.yaml`, with a warning if they disagree. In a legacy major directory, the declaration
selects the minor version. These settings control model diagnostics; the YAML extension's
contributed property schemas remain v2.8.

While a model file cannot be parsed or read, missing-reference findings are suppressed to avoid
false alarms. Duplicate findings from readable, valid files remain available. YAML aliases are
resolved with a maximum alias count of 100; invalid or excessive alias expansion makes that file
unavailable for these rules. Findings reached through an alias underline the authored alias token.
Syntax and structural schema diagnostics remain the YAML extension's responsibility.

## Configuration

Both diagnostic severities accept `error`, `warning`, `information`, `hint` or `off`.

| Setting | Default | Description |
|---|---|---|
| `archallyBlueprint.diagnostics.debounceMs` | `300` | Unsaved diagnostic/decorations delay, from 0 to 5000 ms. |
| `archallyBlueprint.diagnostics.duplicateSeverity` | `error` | Severity for duplicate ID declarations. |
| `archallyBlueprint.diagnostics.danglingSeverity` | `error` | Severity for missing references. |
| `archallyBlueprint.diagnostics.schemaRoot` | `""` | Optional absolute local version root or its `schema` directory. |
| `archallyBlueprint.diagnostics.schemaVersion` | `""` | Optional explicit version override, for example `2.8`. |
| `archallyBlueprint.fileGlob` | `**/.blueprint/**/*.{yaml,yml}` | Which YAML files to index for id navigation. |
| `archallyBlueprint.highlight.enabled` | `true` | Highlight blueprint IDs with a distinct color/style. |
| `archallyBlueprint.highlight.color` | `""` | Override color (any CSS color, e.g. `#c586c0`). Empty = use the themed `archallyBlueprint.idForeground`. |
| `archallyBlueprint.highlight.fontStyle` | `bold` | `normal` / `bold` / `italic` / `underline` / `bold-underline`. |
| `archallyBlueprint.codeRef.enabled` | `true` | Make `code_refs[].path` clickable → open the file on the git host (from `repository`/`repositories` in `blueprint.yaml`). |
| `archallyBlueprint.codeRef.highlight.enabled` | `true` | Color `code_ref` paths (distinct from IDs) to mark them as clickable links. |
| `archallyBlueprint.codeRef.highlight.color` | `""` | Override the `code_ref` color. Empty = themed `archallyBlueprint.codeRefForeground` (link blue). |
| `archallyBlueprint.codeRef.highlight.fontStyle` | `underline` | `normal` / `bold` / `italic` / `underline` / `bold-underline`. |
| `archallyBlueprint.codeRef.localRoots` | `{}` | Map a repo (`url` or `org/repo` prefix) → a local clone folder so `code_ref`s open on disk. Absolute paths recommended. |
| `archallyBlueprint.codeRef.openBehavior` | `localThenBrowser` | `code_ref` open preference: `localThenBrowser` (local if present, else git host) / `browser` / `local` (no fallback). |
| `archallyBlueprint.referenceLinks.enabled` | `true` | Linkify `http(s)` URLs anywhere + `evidence[].source` file-paths (open browser / local file). |

To recolor without the override setting, theme it: `"workbench.colorCustomizations": { "archallyBlueprint.idForeground": "#c586c0" }`.

### Opening local clones

By default a `code_ref` opens on the git host. To open your **local checkout** instead, map the repo to its
folder - key = the `url` from the owning `blueprint.yaml` (or the `org/repo` prefix), value = an absolute folder:

```jsonc
"archallyBlueprint.codeRef.localRoots": {
  "https://github.com/PrestaShop/PrestaShop": "C:/code/PrestaShop"
}
```

A `code_ref` whose file exists under that folder now opens in the editor (even if the code repo isn't part of
this workspace); anything unmapped or missing falls back to the git host. `archallyBlueprint.codeRef.openBehavior`
overrides the preference - `browser` = always the host, `local` = never fall back. A relative `localRoots` folder
resolves against the workspace folder, but absolute paths are recommended.

## How it works

The model diagnostic layer parses YAML into a cached syntax tree, runs the bundled conformance
reference rules and maps structured finding paths to authored token ranges. It caches sibling
files and schema inputs, then publishes the latest result through a diagnostic collection.

On activation it scans the configured glob for `id:` declarations and builds an in-memory `id → location(s)`
index (with a short summary pulled from the nearby `kind`/`name`/`summary` keys). The Definition and Hover
providers match the token under the cursor against that index. No build step or `model.json` is required - the
line scan gives exact source locations and works even before the model is generated.

## Scope of the token grammar

Resolves scoped ids (`slice.TYPE###`, e.g. `inventory.CN004`) and bare ids (`TYPE###`, `MIG###`, `CAT####`).
Resolution is exact-string against declared `id:` values, so a reference resolves only to an entity that is
actually declared with that id.
