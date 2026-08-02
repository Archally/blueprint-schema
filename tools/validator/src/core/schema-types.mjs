import path from "node:path";

export const FILENAME_TO_SCHEMA = {
  blueprint: "blueprint.schema.yaml",
  migration: "migration.schema.yaml",
  concepts: "design/concepts.schema.yaml",
  rules: "design/rules.schema.yaml",
  domain: "design/domain.schema.yaml",
  arch: "design/arch.schema.yaml",
  models: "design/models.schema.yaml",
  story: "design/story.schema.yaml",
  dynamics: "design/dynamics.schema.yaml",
  quality: "design/quality.schema.yaml",
  // `rg`, `ui` and `org` are the layer names used BEFORE v2.7. The v2.6→v2.7 boundary renamed
  // them to `infrastructure`, `interactions` and `organization` (schema-update migration
  // `001-rename-acronym-schemas`). Both spellings are mapped so that a model declaring v2.4–v2.6
  // validates against the schemas it was authored for: behaviour follows the model's DECLARED
  // schema version, and an unrecognised layer is never skipped in silence. Retiring a schema
  // version is a deliberate, dated act — not the side effect of dropping a mapping here.
  rg: "design/rg.schema.yaml", // pre-v2.7 name for `infrastructure`
  infrastructure: "design/infrastructure.schema.yaml",
  ui: "design/ui.schema.yaml", // pre-v2.7 name for `interactions`
  interactions: "design/interactions.schema.yaml",
  motivation: "governance/motivation.schema.yaml",
  capability: "governance/capability.schema.yaml",
  decisions: "governance/decisions.schema.yaml",
  "test-cases": "governance/test-cases.schema.yaml",
  org: "governance/org.schema.yaml", // pre-v2.7 name for `organization`
  organization: "governance/organization.schema.yaml",
  roadmap: "governance/roadmap.schema.yaml",
  "value-stream": "governance/value-stream.schema.yaml",
  leverage: "governance/leverage.schema.yaml",
};

export function detectSchemaType(filePath) {
  const basename = path.basename(filePath, path.extname(filePath));

  // Dotfiles are TOOL CONFIGURATION colocated with the model, never model content — a blueprint
  // layer file is `{layer}.yaml` or `{name}.{layer}.yaml`, never `.{something}.yaml`. Without this
  // guard the quality gate's own `.blueprint-quality.yaml` matched the `-${key}` branch below
  // (`.blueprint-quality`.endsWith('-quality')) and was validated against the quality LAYER schema,
  // producing 3 spurious schema errors on an otherwise-clean model. The monorepo stack never saw
  // this: its rule is dot-only (`^[^/\\]+\.(<types>)\.(yaml|yml)$`), so the same file is skipped
  // there and the two stacks disagreed on identical input.
  if (basename.startsWith(".")) return null;

  if (FILENAME_TO_SCHEMA[basename]) return basename;
  for (const key of Object.keys(FILENAME_TO_SCHEMA)) {
    // NOTE: the `-${key}` form is a divergence from the monorepo's dot-only pattern, kept because
    // a downstream model may already rely on it. It matches nothing in this repo's 182 example
    // YAMLs. If it is ever retired, retire it in both stacks at once.
    if (basename.endsWith(`-${key}`) || basename.endsWith(`.${key}`)) {
      return key;
    }
  }
  return null;
}
