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
  const infraScopeFiles = []; // { relFile, scopes } per infrastructure file that declares deployment_scopes
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

    // v2.7.7 DeploymentScope (DSC###): stash scopes for the post-loop graph checks below.
    if (schemaType === "infrastructure" && Array.isArray(data.deployment_scopes)) {
      infraScopeFiles.push({ relFile, scopes: data.deployment_scopes });
    }
  }

  for (const [id, locs] of allDuplicates.entries()) {
    warnings.push(`Duplicate ID '${id}' in: ${locs.join(", ")}`);
  }

  // RT### refs (resource `type_ref`, service `needs[].type_ref`, binding `type_ref`) point to the
  // resource-type CATALOG in the profiles (schema/v2.7/profiles/infrastructure/**), NOT the model —
  // skip them so a valid `type_ref: RT001` is never falsely flagged "Missing" (mirror of the monorepo
  // standalone validator, RD34c — the two validator stacks must agree on this).
  const CATALOG_REF_RE = /^([a-z][a-z0-9-]*\.)?RT\d{3,}$/;
  for (const r of allRefs) {
    if (CATALOG_REF_RE.test(r.value)) continue;
    if (!allIds.has(r.value)) {
      crossErrors.push(`Missing reference '${r.value}' at ${r.loc}`);
    }
  }

  checkGaps(yamlFiles, modelDir, warnings);

  // v2.7.7 DeploymentScope (DSC###) hierarchy checks — mirror of the monorepo validator
  // (schemas/blueprint/v2.7/validation/validate-blueprint.mjs). scope_ref (ends `_ref`) and
  // target_scope.ref (a LIKELY_REF_KEY) resolvability is already covered by the generic
  // cross-ref walk above; here we add the two things that need the scope GRAPH, plus the
  // typed-id WARN:
  //   - DSC### FORMAT → WARN (free-string id valid but discouraged; REQUIRED in v2.8, RD25)
  //   - dangling `parent` → Cross-Reference Error (`parent` is not a generic ref key)
  //   - a cycle in the `parent` chain → schema-level ERROR (a subscription→resource-group
  //     hierarchy must be a tree).
  const DSC_RE = /^([a-z][a-z0-9-]*\.)?DSC\d{3,}$/;
  const scopeParent = new Map(); // scopeId → parentId (only scopes that declare a parent)
  const scopeLoc = new Map(); // scopeId → relFile (every declared scope)
  for (const { relFile, scopes } of infraScopeFiles) {
    for (const scope of scopes) {
      if (!scope || typeof scope !== "object" || typeof scope.id !== "string") continue;
      if (!DSC_RE.test(scope.id)) {
        warnings.push(
          `[${relFile}] Deployment scope id "${scope.id}" SHOULD match DSC### (v2.7.7 typed-id convention, RD25) — free-string is valid but discouraged; required in v2.8`,
        );
      }
      scopeLoc.set(scope.id, relFile);
      if (typeof scope.parent === "string") scopeParent.set(scope.id, scope.parent);
    }
  }
  for (const [id, parent] of scopeParent.entries()) {
    if (!scopeLoc.has(parent)) {
      crossErrors.push(
        `Missing reference '${parent}' at ${scopeLoc.get(id)}.deployment_scopes (DeploymentScope '${id}' parent)`,
      );
    }
  }
  // Cycle detection over the functional parent-graph (each scope has ≤1 parent).
  const inCycle = new Set();
  for (const start of scopeParent.keys()) {
    if (inCycle.has(start)) continue;
    const seenIndex = new Map();
    const chain = [];
    let cur = start;
    while (cur !== undefined && scopeParent.has(cur) && !seenIndex.has(cur)) {
      seenIndex.set(cur, chain.length);
      chain.push(cur);
      cur = scopeParent.get(cur);
    }
    if (cur !== undefined && seenIndex.has(cur)) {
      const cycle = chain.slice(seenIndex.get(cur));
      if (!cycle.some((n) => inCycle.has(n))) {
        cycle.forEach((n) => inCycle.add(n));
        schemaErrors.push(
          `DeploymentScope parent hierarchy forms a cycle: ${cycle.join(" → ")} → ${cycle[0]} — scope.parent must be acyclic (a subscription→resource-group tree)`,
        );
      }
    }
  }

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
      // Only invocable operations (commands/queries) need a wire transport. Events are domain facts
      // (exempt, cf. AP21), and an op marked `dispatch: in-process` is intentionally transport-less.
      const needsExchange = op.kind === "command" || op.kind === "query";
      if (needsExchange && !op.exchange && op.dispatch !== "in-process") {
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
