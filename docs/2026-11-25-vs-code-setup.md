# VS Code setup

Open the cloned repository as a folder in VS Code. Its `.vscode/` settings give every blueprint
file kind and contract kind its own icon with [Material Icon Theme](https://marketplace.visualstudio.com/items?itemName=PKief.material-icon-theme).
The [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
validates blueprint files against the schema. VS Code offers to install both extensions.

## Open your model and the schema in one window

Start from the [workspace template](../.vscode/blueprint-schema.code-workspace). For a multi-root
window, VS Code reads the icon settings and `yaml.schemas` from the workspace file, so the
template supplies them.

1. Set the second folder's `path` to the repository containing your product's `.blueprint/` model.
   Relative paths resolve from the workspace file. The placeholder `../../my-project` points to
   a sibling clone named `my-project`. To keep this clone unchanged, copy the template elsewhere
   first and set both folder paths.
2. Use **File > Open Workspace from File** to open the workspace.

If you already have a `.code-workspace` file, copy the template's `settings` entries into it.
These are `workbench.iconTheme`, `yaml.schemas`, and both `material-icon-theme.*` keys.
Name this repository's folder `blueprint-schema` so the `yaml.schemas` paths resolve.

A matching entry in your user `material-icon-theme.files.associations` takes precedence over the
workspace entry. Keep the two entries identical or remove the user entry.
