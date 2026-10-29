# /blueprint-check-all

Run the schema repository's three local checks on a blueprint and drive them to a clean run.

Argument: `$ARGUMENTS` - path to the blueprint directory (e.g. `.blueprint/v2.8`, or
`examples/prestashop/.blueprint/v2.8` inside the schema repository).

## Steps

1. **Resolve the model.** With an argument, resolve it to an absolute `MODEL_DIR`. Without one, list
   the candidates under the project root (the repository root, else the current directory):

   ```bash
   PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
   find "$PROJECT_ROOT" -path '*/node_modules' -prune -o -type d -path '*/.blueprint/v*' -print -prune
   ```

   Accept the result only when it names exactly one directory, and confirm it with the user. Several
   candidates (another version, an example model, a sibling project) mean you ask which one; never
   pick one yourself.

2. **Bind the schema root**, in this order: the path the user gave in this session; the
   `BLUEPRINT_SCHEMA_ROOT` environment variable; the current repository root when it is the schema
   repository itself. If none applies, ask for the path to their clone. Never download it and never
   guess a sibling directory.

   ```bash
   SCHEMA_ROOT="$(cd "${BLUEPRINT_SCHEMA_ROOT:-<schema-root>}" && pwd)" || exit 2
   node -e 'process.exit(require(process.argv[1]).name === "@archally/blueprint-schema" ? 0 : 1)' \
     "$SCHEMA_ROOT/package.json" 2>/dev/null && test -d "$SCHEMA_ROOT/schema" \
     || { echo "not a blueprint schema root: $SCHEMA_ROOT"; exit 2; }
   test -d "$SCHEMA_ROOT/node_modules" || echo "missing prerequisite: npm --prefix \"$SCHEMA_ROOT\" install"
   test -f "$SCHEMA_ROOT/tools/semantic-checker/dist/cli.js" \
     || echo "missing prerequisite: npm --prefix \"$SCHEMA_ROOT\" run build"
   ```

   Run a missing prerequisite only with the user's consent (`install` fetches npm dependencies,
   `run build` compiles the TypeScript tools; Node 20 or later).

3. **Run the trio** with absolute paths. `npm --prefix` runs each script from the schema root, so a
   relative path, or a configuration file the tool looks for in the working directory, would resolve
   there instead of in the project. The `--` keeps flags such as `--json` away from npm itself.

   ```bash
   npm --prefix "$SCHEMA_ROOT" run validate -- "$MODEL_DIR" --schemas "$SCHEMA_ROOT/schema"
   npm --prefix "$SCHEMA_ROOT" run check -- "$MODEL_DIR"
   npm --prefix "$SCHEMA_ROOT" run quality -- "$MODEL_DIR"
   ```

   The validator picks the schema version from the model path; confirm its `Schemas:` line names the
   version you expect and its `Files:` line reports more than zero files validated. If the project
   keeps a `.blueprint-lint.yaml`, pass it to the checker as
   `--config "$PROJECT_ROOT/.blueprint-lint.yaml"`; without that flag the checker uses its defaults.
   The quality gate finds `.blueprint-quality.yaml` on its own, beside or above the model.

   If the slice is part of an existing model, prefer
   `npm --prefix "$SCHEMA_ROOT" run quality -- "$MODEL_DIR" --since <base-ref> --strict` - it holds the
   files you touched to the higher bar without demanding the whole model be clean. `--since` reads git
   history in the repository that holds the model, not in the schema root.

4. **Interpret** (see the `blueprint-validate` skill for detail). Keep four kinds of result apart:
   - **Schema or reference error** - validator exit 1. For each: name the file/entity, explain the
     cause (bad reference vs schema violation), and fix the **root cause** - correct the target ID / add
     the missing entity, or align the YAML to the schema version on the validator's `Schemas:` line.
     Never delete content just to clear an error. Exit 0 with warnings is a **PASS**; warnings are depth
     hints like "no exchange block". Summarize their categories, don't force them to zero.
   - **Checker finding** - structural gaps (orphans, unbound operations, untested rules). `FAILED` with
     exit 1 means error-severity findings; `PASSED` with warnings is a pass. Fix or explain each;
     severity is tunable in `.blueprint-lint.yaml`.
   - **Quality gap** - self-description coverage, splitting **missing** from **filler** (prose that
     merely restates the field name). Filler counts against you like a missing value - rewrite it. The
     default run reports and exits 0; `--strict` exits 1 on a breach.
   - **Missing prerequisite or runner failure** - not a model defect. Validator exit 2, checker exit 2
     (a `--config` file that does not exist), quality exit 2 (bad arguments, unreadable configuration,
     a model file that did not parse), npm `ENOENT` (no
     package at the schema root), or `Cannot find module .../dist/cli.js` from the checker (the build
     has not run; npm reports exit 1 here too, so read the message). Fix the setup and re-run.

5. **Re-run** until the validator exits 0 and the other two are clean for the touched files. Report the
   final result in one line per tool.

   A slice is done when all three are satisfied - or every remaining gap is recorded in
   `.blueprint-quality.yaml` as a deferral with a **reason** and an **expiry date**. Never close a
   slice on a silent gap.
