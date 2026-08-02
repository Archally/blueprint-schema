import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { walkFiles, loadYaml, toPosixPath } from "./utils.mjs";

const SCHEMA_BASE_URI = "https://archally.pro/schemas/";

export { SCHEMA_BASE_URI };

export function loadSchemaRegistry(versionRoot) {
  const schemaDir = fs.existsSync(path.join(versionRoot, "schema"))
    ? path.join(versionRoot, "schema")
    : versionRoot;
  if (!fs.existsSync(schemaDir)) {
    throw new Error(`Schema directory not found: ${schemaDir}`);
  }
  const schemaFiles = walkFiles(
    schemaDir,
    (f) => /\.schema\.(yaml|yml)$/i.test(f),
  );
  const registry = new Map();
  for (const filePath of schemaFiles) {
    const rel = toPosixPath(path.relative(schemaDir, filePath));
    registry.set(rel, loadYaml(filePath));
  }
  return { registry, schemaDir };
}

export function makeAjv(registry) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateSchema: false,
  });
  addFormats(ajv);
  const sorted = [...registry.entries()].sort(([a], [b]) => {
    const aRoot = !a.includes("/") ? 0 : a.startsWith("design/") ? 1 : 2;
    const bRoot = !b.includes("/") ? 0 : b.startsWith("design/") ? 1 : 2;
    return aRoot !== bRoot ? aRoot - bRoot : a.localeCompare(b);
  });
  for (const [rel, schema] of sorted) {
    const normalized = structuredClone(schema);
    normalized.$id = SCHEMA_BASE_URI + rel;
    ajv.addSchema(normalized);
  }
  return ajv;
}
