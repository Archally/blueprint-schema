# Changelog — Archally Blueprint Navigation

All notable changes to this extension. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
this extension versions independently of `@archally/blueprint-schema`.

## 0.4.0

Local `code_ref` resolution and hover.

- **Open `code_refs` from a local clone.** New `archallyBlueprint.codeRef.localRoots` maps a repository
  (by its `url` from the owning `blueprint.yaml`, or by its `org/repo` prefix) to a local folder; a `code_ref`
  whose file exists under that folder opens **in the editor** (even when the code repo is not part of the
  workspace), otherwise it falls back to the git host. `archallyBlueprint.codeRef.openBehavior`
  (`localThenBrowser` default / `browser` / `local`) controls the preference. A relative `localRoots` folder
  resolves against the workspace folder; absolute is recommended.
- **Hover on a `code_ref` path** shows where it resolves (local path or host URL), its `role`/`description`,
  and — when it resolves to nothing — a single, actionable hint (add `repository:` or set `codeRef.localRoots`).
  Hover-only, so files with many unresolved refs never produce error noise.
- Settings changes (`localRoots` / `openBehavior` / the enable toggles) now re-resolve links **live** without a
  window reload.

## 0.3.0

External-reference links.

- **`code_ref` paths → clickable git-host links** (GitHub / GitLab / Bitbucket / `x-*`), built from the
  `repository` / `repositories` block of the owning `blueprint.yaml`; handles same-repo and cross-repo
  `org/repo#path` refs. Paths are coloured a distinct link-blue (`archallyBlueprint.codeRefForeground`).
- **Reference links** (`archallyBlueprint.referenceLinks.enabled`): any `http(s)` URL anywhere in a `.blueprint`
  YAML opens in the browser, and an `evidence[].source` that is a repo-relative path opens the workspace file.

## 0.1.0

Initial release.

- Blueprint **ID** go-to-definition, hover, highlight, and re-index across `.blueprint/**` YAML files.
