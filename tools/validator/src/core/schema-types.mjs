import { getSchemaForFile } from "./schema-routing.mjs";

/**
 * The schema file each layer is checked against, relative to a schema line's root. Every layer the
 * model builder loads has an entry; a line that lacks the schema file compiles no validator for it.
 */
export const FILENAME_TO_SCHEMA = {
  blueprint: "blueprint.schema.yaml",
  migration: "migration.schema.yaml",
  migrations: "migrations.schema.yaml",
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
  // version is a deliberate, dated act - not the side effect of dropping a mapping here.
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

/**
 * The layer a model file holds, read from its file name; null for a file that is not part of the
 * model. This is the model builder's own answer (`getSchemaForFile`), so the validator checks
 * exactly the files the builder loads. Files the builder does not load are described by
 * `file-membership.mjs`.
 *
 * @param {string} filePath
 * @returns {string | null}
 */
export function detectSchemaType(filePath) {
  return getSchemaForFile(filePath);
}
