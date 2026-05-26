import fs from "node:fs";
import path from "node:path";
import { toPosixPath, walkFiles, loadYaml } from "./utils.mjs";
import { loadSchemaRegistry, makeAjv, SCHEMA_BASE_URI } from "./schema-registry.mjs";
import { FILENAME_TO_SCHEMA, detectSchemaType } from "./schema-types.mjs";
import { collectIds, collectRefs } from "./references.mjs";

function formatAjvErrors(errors) {
  if (!errors) return [];
  return errors.map((e) => {
    const at = e.instancePath ? e.instancePath : "/";
    return `${at} -> ${e.message ?? "schema error"}`;
  });
}

export function validateModel(args) {
  const { registry } = loadSchemaRegistry(args.schemas);
  const ajv = makeAjv(registry);

  const modelDir = args.model;
  if (!fs.existsSync(modelDir)) {
    throw new Error(`Model directory not found: ${modelDir}`);
  }
  const isDir = fs.statSync(modelDir).isDirectory();
  const yamlFiles = isDir
    ? walkFiles(modelDir, (f) => /\.(yaml|yml)$/i.test(f))
    : [path.resolve(modelDir)];

  const schemaErrors = [];
  const crossErrors = [];
  const warnings = [];
  const allIds = new Map();
  const allDuplicates = new Map();
  const allRefs = [];
  let filesValidated = 0;
  let filesSkipped = 0;

  for (const filePath of yamlFiles) {
    const schemaType = detectSchemaType(filePath);
    if (!schemaType) { filesSkipped += 1; continue; }

    const schemaRelPath = FILENAME_TO_SCHEMA[schemaType];
    if (!schemaRelPath) { filesSkipped += 1; continue; }

    let data;
    try {
      data = loadYaml(filePath);
    } catch (err) {
      schemaErrors.push(`[${toPosixPath(path.relative(modelDir, filePath))}] Parse error: ${err.message}`);
      continue;
    }
    if (!data || typeof data !== "object") continue;

    const schemaUri = SCHEMA_BASE_URI + schemaRelPath;
    const validate = ajv.getSchema(schemaUri);
    const relFile = toPosixPath(path.relative(modelDir, filePath));
    if (!validate) {
      warnings.push(`[${relFile}] No validator for schema type "${schemaType}" (${schemaUri})`);
      continue;
    }

    const valid = validate(data);
    if (!valid) {
      const errs = formatAjvErrors(validate.errors);
      for (const e of errs) {
        schemaErrors.push(`[${relFile}] ${e}`);
      }
    }
    filesValidated += 1;

    collectIds(data, allIds, allDuplicates, [relFile]);
    collectRefs(data, allRefs, [relFile]);
  }

  for (const [id, locs] of allDuplicates.entries()) {
    warnings.push(`Duplicate ID '${id}' in: ${locs.join(", ")}`);
  }

  for (const r of allRefs) {
    if (!allIds.has(r.value)) {
      crossErrors.push(`Missing reference '${r.value}' at ${r.loc}`);
    }
  }

  checkGaps(yamlFiles, modelDir, warnings);

  if (args.compat && schemaErrors.length > 0) {
    warnings.push(
      ...schemaErrors.map((e) => `Compat schema warning: ${e}`),
      "Compat mode active: schema violations are non-fatal.",
    );
    schemaErrors.length = 0;
  }

  return { schemaErrors, crossErrors, warnings, modelPath: modelDir, filesValidated, filesSkipped };
}

function checkGaps(yamlFiles, modelDir, warnings) {
  for (const filePath of yamlFiles) {
    const schemaType = detectSchemaType(filePath);
    if (schemaType !== "domain") continue;
    let data;
    try { data = loadYaml(filePath); } catch { continue; }
    if (!data?.operations) continue;
    const relFile = toPosixPath(path.relative(modelDir, filePath));
    for (const [key, op] of Object.entries(data.operations)) {
      if (!op.exchange) {
        warnings.push(`[${relFile}] Operation "${key}" (${op.id ?? "no-id"}) has no exchange block`);
      }
    }
  }

  for (const filePath of yamlFiles) {
    const schemaType = detectSchemaType(filePath);
    if (schemaType !== "arch") continue;
    let data;
    try { data = loadYaml(filePath); } catch { continue; }
    if (!data?.parties) continue;
    const relFile = toPosixPath(path.relative(modelDir, filePath));
    for (const party of data.parties) {
      if (!party.contexts) continue;
      for (const context of party.contexts) {
        if (!context.services) continue;
        for (const service of context.services) {
          if (!service.contracts) {
            warnings.push(`[${relFile}] Service "${service.name}" in party "${party.name}" has no contracts block`);
          }
        }
      }
    }
  }
}
