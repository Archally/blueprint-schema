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
  infrastructure: "design/infrastructure.schema.yaml",
  motivation: "governance/motivation.schema.yaml",
  capability: "governance/capability.schema.yaml",
  decisions: "governance/decisions.schema.yaml",
  "test-cases": "governance/test-cases.schema.yaml",
  organization: "governance/organization.schema.yaml",
  interactions: "design/interactions.schema.yaml",
  roadmap: "governance/roadmap.schema.yaml",
  "value-stream": "governance/value-stream.schema.yaml",
};

export function detectSchemaType(filePath) {
  const basename = path.basename(filePath, path.extname(filePath));
  if (FILENAME_TO_SCHEMA[basename]) return basename;
  for (const key of Object.keys(FILENAME_TO_SCHEMA)) {
    if (basename.endsWith(`-${key}`) || basename.endsWith(`.${key}`)) {
      return key;
    }
  }
  return null;
}
