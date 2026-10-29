---
description: Scaffold a new, minimal, valid blueprint under .blueprint/v2.8/
argument-hint: <target-dir> [product name]
---

# /blueprint-new

Create the smallest **valid** blueprint for the user, then hand off to the `blueprint-modeler` agent to
grow it.

Arguments: `$ARGUMENTS` - first token is the target project directory (default: current directory);
the rest, if present, is the product name.

## Steps

1. **Resolve the target.** The blueprint lives at `<target-dir>/.blueprint/v2.8/`. If `<target-dir>` is
   omitted, use the current directory. Resolve it to an absolute path and confirm it with the user if
   it is ambiguous. Then look for existing models:

   ```bash
   PROJECT_ROOT="$(cd "<target-dir>" && pwd)"
   find "$PROJECT_ROOT/.blueprint" -mindepth 1 -maxdepth 1 -type d -name 'v*' 2>/dev/null
   ```

   If this lists any directory, stop: a model already exists there. Ask the user whether to extend it
   or to pick another target. Never overwrite a file and never pick one of several models yourself.

2. **Bind the schema root.** The checks run the public schema repository's own npm scripts, so they
   need a local copy of it. Resolve `SCHEMA_ROOT`, in this order, and stop at the first that applies:
   the path the user gave in this session; the `BLUEPRINT_SCHEMA_ROOT` environment variable; the
   current repository root when it is the schema repository itself. If none applies, ask the user for
   the path to their clone. Never download it and never guess a sibling directory.

   ```bash
   SCHEMA_ROOT="$(cd "${BLUEPRINT_SCHEMA_ROOT:-<schema-root>}" && pwd)" || exit 2
   node -e 'process.exit(require(process.argv[1]).name === "@archally/blueprint-schema" ? 0 : 1)' \
     "$SCHEMA_ROOT/package.json" 2>/dev/null && test -d "$SCHEMA_ROOT/schema/v2.8" \
     || { echo "not a blueprint schema root: $SCHEMA_ROOT"; exit 2; }
   test -d "$SCHEMA_ROOT/node_modules" || echo "missing prerequisite: npm --prefix \"$SCHEMA_ROOT\" install"
   test -f "$SCHEMA_ROOT/tools/semantic-checker/dist/cli.js" \
     || echo "missing prerequisite: npm --prefix \"$SCHEMA_ROOT\" run build"
   ```

   A missing prerequisite is not a modeling error. Tell the user which command is missing and run it
   only with their consent: `install` fetches the repository's npm dependencies, `run build` compiles
   its TypeScript tools locally. Both need Node 20 or later.

3. **Create two files** (the minimal valid blueprint):

   ```yaml
   # <target-dir>/.blueprint/v2.8/blueprint.yaml
   version: "1.0.0"
   name: "<product name, or 'My Service'>"
   ```

   ```yaml
   # <target-dir>/.blueprint/v2.8/<slice>/concepts.yaml
   version: "1.0.0"
   concepts:
     - id: CN001
       name: "<the core aggregate>"
       stereotype: aggregate-root
       description: "<one sentence: what it is>"
   ```

   Pick a sensible `<slice>` folder name (kebab-case) from the domain - e.g. `orders`, `catalog`. Ask
   for the core aggregate if you can't infer it from the product name.

4. **Validate** (must pass before you continue). Pass absolute paths: `npm --prefix` runs each script
   from the schema root, so a relative model path would resolve there instead of in the project.

   ```bash
   MODEL_DIR="$PROJECT_ROOT/.blueprint/v2.8"
   npm --prefix "$SCHEMA_ROOT" run validate -- "$MODEL_DIR" --schemas "$SCHEMA_ROOT/schema"
   npm --prefix "$SCHEMA_ROOT" run check -- "$MODEL_DIR"
   ```

   The validator must exit 0 and its `Files:` line must report the two files validated; a pass over
   zero files proves nothing. Exit 1 is a schema or reference error in the seed: fix it. Exit 2 is a
   runner failure (no schemas found, unreadable configuration): fix the setup, not the model. The
   checker should pass too; a warning on a one-concept seed is expected depth, not a defect.

5. **Report and hand off.** Show the two files and the passing validation, then offer:
   *"Minimal blueprint created and valid. Want me to grow it? I'd start by discovering the core flow
   (2-3 questions), then add commands, events, and a story."* Continue as the `blueprint-modeler`.

Keep it minimal - do **not** pre-populate layers the user hasn't asked for. The point is a valid seed,
not a finished model.
