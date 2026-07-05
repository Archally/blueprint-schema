# Archally Blueprint Navigation (VS Code)

Go-to-definition + hover for **Archally blueprint IDs** across `.blueprint/**` YAML files.

A blueprint references entities by typed id — `billing.CMD012`, `orders.EVT006`, a bare root risk `R005`,
a migration `MIG003`, an attribute `CAT1200`. The JSON Schema (via `redhat.vscode-yaml`) validates an id's
**shape** but not **where it is defined**, so VS Code can't natively jump to or preview it. This extension closes
that gap.

## Features

- **Go to Definition** (`F12` / `Ctrl`+click) on any id → jumps to its `id:` declaration, wherever in the
  workspace it lives (the loader merges files by suffix, so a referenced id is often in another file).
- **Hover** → shows the entity's kind/name + summary and the **source file:line**, with a click-to-open link.
- Indexes both block (`- id: orders.CMD001`) and inline (`{ id: CAT1200, ... }`) declarations.
- **Highlight known ids** with a distinct color/style (decoration-based, so it's the same on **any theme**). Only ids
  that are actually *declared* somewhere get coloured — **canary yellow** by default (`archallyBlueprint.idForeground`) —
  so a mistyped or unknown reference stays un-coloured, an easy correctness signal. Configurable color +
  weight/style/underline. Note: the editor font *family* can't be changed per token — only color/weight/style/underline.
- **Open `code_refs`** (`Ctrl`+click) on a `code_refs[].path` → opens that source file on its git host
  (GitHub / GitLab / Bitbucket), built from the `repository` / `repositories` block in the owning
  `blueprint.yaml`. Handles same-repo paths and cross-repo `org/repo#path` refs. `code_ref` paths are
  shown in a **distinct link colour** (link-blue by default, `archallyBlueprint.codeRefForeground`) so they
  read as clickable and don't blend with the canary-yellow IDs. (Opening a *local clone* instead of the
  browser is coming in a later release.)
- **Open evidence & URL references** (`Ctrl`+click) → any `http(s)://` URL anywhere in a `.blueprint` YAML
  (evidence `source`, issue trackers, doc links) opens in the browser; an `evidence[].source` that is a
  repo-relative path opens the local workspace file. Shares the code_ref link colour.
- Re-indexes on save / file change; **Archally Blueprint: Re-index IDs** command to rebuild on demand.

It complements `redhat.vscode-yaml` (schema validation + autocomplete + hover on property *keys*) — install both.

## Install / run (dev)

```bash
cd tools/vscode-blueprint
npm install
npm run compile      # or: npm run watch
```

Then press **F5** in VS Code (with this folder open) to launch an Extension Development Host, open a workspace
that contains a `.blueprint/` tree, and Ctrl+click an id like `orders.EVT006`.

To package a `.vsix` for normal installation:

```bash
npx @vscode/vsce package
code --install-extension archally-blueprint-navigation-0.1.0.vsix
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| `archallyBlueprint.fileGlob` | `**/.blueprint/**/*.yaml` | Which YAML files to index for id navigation. |
| `archallyBlueprint.highlight.enabled` | `true` | Highlight blueprint IDs with a distinct color/style. |
| `archallyBlueprint.highlight.color` | `""` | Override color (any CSS color, e.g. `#c586c0`). Empty = use the themed `archallyBlueprint.idForeground`. |
| `archallyBlueprint.highlight.fontStyle` | `bold` | `normal` / `bold` / `italic` / `underline` / `bold-underline`. |
| `archallyBlueprint.codeRef.enabled` | `true` | Make `code_refs[].path` clickable → open the file on the git host (from `repository`/`repositories` in `blueprint.yaml`). |
| `archallyBlueprint.codeRef.highlight.enabled` | `true` | Color `code_ref` paths (distinct from IDs) to mark them as clickable links. |
| `archallyBlueprint.codeRef.highlight.color` | `""` | Override the `code_ref` color. Empty = themed `archallyBlueprint.codeRefForeground` (link blue). |
| `archallyBlueprint.codeRef.highlight.fontStyle` | `underline` | `normal` / `bold` / `italic` / `underline` / `bold-underline`. |
| `archallyBlueprint.referenceLinks.enabled` | `true` | Linkify `http(s)` URLs anywhere + `evidence[].source` file-paths (open browser / local file). |

To recolor without the override setting, theme it: `"workbench.colorCustomizations": { "archallyBlueprint.idForeground": "#c586c0" }`.

## How it works

On activation it scans the configured glob for `id:` declarations and builds an in-memory `id → location(s)`
index (with a short summary pulled from the nearby `kind`/`name`/`summary` keys). The Definition and Hover
providers match the token under the cursor against that index. No build step or `model.json` is required — the
line scan gives exact source locations and works even before the model is generated.

## Scope of the token grammar

Resolves scoped ids (`slice.TYPE###`, e.g. `inventory.CN004`) and bare ids (`TYPE###`, `MIG###`, `CAT####`).
Resolution is exact-string against declared `id:` values, so a reference resolves only to an entity that is
actually declared with that id.
