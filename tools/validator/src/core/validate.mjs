import fs from "node:fs";
import path from "node:path";
import { toPosixPath, walkFiles, loadYaml } from "./utils.mjs";
import { loadSchemaRegistry, makeAjv, SCHEMA_BASE_URI } from "./schema-registry.mjs";
import { FILENAME_TO_SCHEMA, detectSchemaType } from "./schema-types.mjs";
import {
  collectIds,
  collectRefs,
  isIdentityOrReferenceViolation,
  isPartyRedeclaration,
} from "./references.mjs";

/** `RT###` refs point to the resource-type CATALOG in the profiles, never into the model. */
const CATALOG_REF_RE = /^([a-z][a-z0-9-]*\.)?RT\d{3,}$/;

/**
 * v2.7.7 typed-id conventions (RD25). A free-string id stays schema-VALID but SHOULD carry the
 * typed prefix; enforcement lands in v2.8. Warn only — never an error.
 */
const TYPED_ID = [
  { key: "resources", kind: "Infrastructure resource", expected: "IR###", re: /^([a-z][a-z0-9-]*\.)?IR\d{3,}$/ },
  { key: "environments", kind: "Environment", expected: "ENV###", re: /^([a-z][a-z0-9-]*\.)?ENV\d{3,}$/ },
  { key: "bindings", kind: "Binding", expected: "BND###", re: /^([a-z][a-z0-9-]*\.)?BND\d{3,}$/ },
  { key: "deployment_scopes", kind: "Deployment scope", expected: "DSC###", re: /^([a-z][a-z0-9-]*\.)?DSC\d{3,}$/ },
];

/**
 * The schema version a run is operating under, read from what the caller supplied and otherwise
 * from the model path (a model directory names its own version, e.g. `.blueprint/v2.6`).
 * Returns null when nothing declares one.
 */
function detectSchemaVersion(args) {
  const sources = [args.schemaVersion, args.model, args.schemas];
  for (const source of sources) {
    if (typeof source !== "string") continue;
    const match = source.match(/v?(\d+)\.(\d+)/);
    if (match) return { major: Number(match[1]), minor: Number(match[2]) };
  }
  return null;
}

/** `a >= b` over {major, minor}. */
function atLeast(version, major, minor) {
  if (!version) return true; // nothing declared → assume current semantics
  return version.major > major || (version.major === major && version.minor >= minor);
}

/**
 * The slices this model declares, from the root file's `layout.slices[].name`.
 *
 * The DECLARED list, deliberately — not the directories on disk. A contract naming a slice the
 * model never declared is the defect this rule reports; deriving the vocabulary from the filesystem
 * would make that case unreportable, because the typo'd directory would vote for itself.
 */
export function declaredSlices(parsedFiles) {
  const names = new Set();
  for (const { schemaType, data } of parsedFiles) {
    if (schemaType !== "blueprint") continue;
    for (const slice of data?.layout?.slices ?? []) {
      if (slice && typeof slice.name === "string") names.add(slice.name);
    }
  }
  return names;
}

/**
 * Check a contract's declared `output:` prefix against the slice vocabulary.
 *
 * `output:` is a contract's IDENTITY — the key `multi-service-merge` groups on, which is why two
 * services may legitimately declare the same value. By convention its first segment may name the
 * slice the artifact belongs to; `_global/` marks it explicitly cross-cutting.
 *
 * Warning, never an error: `output:` has always permitted "a filename, optionally under clean
 * subdirs", and models predating this convention prefix with build folders such as `dist/`. Those
 * still render exactly as before — but a prefix that merely LOOKS like a slice and is not one would
 * otherwise be indistinguishable from correct placement, which is the whole failure this reports.
 */
export function checkContractOutputSlice(relFile, serviceName, kind, output, slices) {
  if (typeof output !== "string" || output.trim() === "") return null;
  const cut = output.replace(/\\/g, "/").indexOf("/");
  if (cut <= 0) return null;
  const prefix = output.replace(/\\/g, "/").slice(0, cut);
  if (prefix === "_global" || slices.has(prefix)) return null;
  const known = [...slices].sort().join(", ") || "(none declared)";
  return (
    `[${relFile}] Service "${serviceName}" ${kind} output "${output}" begins with "${prefix}/", ` +
    `which is not a declared slice — the artifact stays under that subdirectory rather than being ` +
    `placed in a slice. Declared slices: ${known}. Use "<slice>/<name>", or "_global/<name>" to ` +
    `mark it cross-cutting.`
  );
}

export function validateModel(args) {
  const { registry } = loadSchemaRegistry(args.schemas);
  const ajv = makeAjv(registry);

  // Rules are not uniform across schema versions, so behaviour follows the version the model
  // DECLARES rather than the newest one this validator knows. From v2.7, only invocable
  // operations (commands and queries) need a wire binding — events are domain facts and are
  // exempt, and `dispatch: in-process` is intentionally transport-less. Before v2.7 every
  // operation was expected to carry an `exchange` block, so a v2.6 model is still held to that.
  const version = detectSchemaVersion(args);
  const eventsExemptFromExchange = atLeast(version, 2, 7);

  const modelDir = args.model;
  if (!fs.existsSync(modelDir)) {
    throw new Error(`Model directory not found: ${modelDir}`);
  }
  const isDir = fs.statSync(modelDir).isDirectory();
  const yamlFiles = isDir
    ? walkFiles(modelDir, (f) => /\.(yaml|yml)$/i.test(f))
    : [path.resolve(modelDir)];

  const schemaErrors = [];
  /** Subset of schemaErrors that `--compat` must never relax (see isIdentityOrReferenceViolation). */
  const nonDemotable = new Set();
  const crossErrors = [];
  const warnings = [];
  const allIds = new Map();
  const allDuplicates = new Map();
  const allRefs = [];
  /**
   * Each recognised file is parsed exactly once and reused by every later pass, so the passes
   * cannot disagree about the same file and warning order stays deterministic.
   */
  const parsedFiles = [];
  let filesValidated = 0;
  let filesSkipped = 0;

  for (const filePath of yamlFiles) {
    const relFile = toPosixPath(path.relative(modelDir, filePath));
    const schemaType = detectSchemaType(filePath);
    const schemaRelPath = schemaType ? FILENAME_TO_SCHEMA[schemaType] : undefined;

    let data;
    try {
      data = loadYaml(filePath);
    } catch (err) {
      // A model directory may hold YAML that is not blueprint content at all (deployment
      // manifests, integration contracts, multi-document files). Failing to parse one of those
      // is not a finding about the model — only a file the schema map RECOGNISES is expected to
      // parse as a blueprint document.
      if (schemaRelPath) {
        schemaErrors.push(`[${relFile}] Parse error: ${err.message}`);
      } else {
        filesSkipped += 1;
      }
      continue;
    }
    if (!data || typeof data !== "object") continue;

    // Every readable YAML document takes part in reference integrity, whether or not a schema
    // recognises its filename. A file the schema map does not cover still declares ids and still
    // points at other entities — skipping it would silently narrow the graph and let dangling
    // references through unreported.
    parsedFiles.push({ relFile, schemaType, data });
    collectIds(data, allIds, allDuplicates, [relFile]);
    collectRefs(data, allRefs, [relFile]);

    // Schema validation, on the other hand, needs a schema. Unrecognised files are counted as
    // skipped and reported as such, never validated against an unrelated schema.
    if (!schemaRelPath) { filesSkipped += 1; continue; }

    const schemaUri = SCHEMA_BASE_URI + schemaRelPath;
    const validate = ajv.getSchema(schemaUri);
    if (!validate) {
      warnings.push(`[${relFile}] No validator for schema type "${schemaType}" (${schemaUri})`);
      continue;
    }

    const valid = validate(data);
    if (!valid) {
      // Iterate the raw Ajv errors (not the pre-formatted strings) so identity/reference
      // violations can be classified from instancePath + message rather than by re-parsing text.
      for (const rawError of validate.errors ?? []) {
        const at = rawError.instancePath ? rawError.instancePath : "/";
        const text = `[${relFile}] ${at} -> ${rawError.message ?? "schema error"}`;
        schemaErrors.push(text);
        if (isIdentityOrReferenceViolation(rawError.instancePath, rawError.message)) {
          nonDemotable.add(text);
        }
      }
    }
    filesValidated += 1;
  }

  for (const [id, locs] of allDuplicates.entries()) {
    // A party re-declared across arch slices and the org layer shares one id BY DESIGN.
    if (isPartyRedeclaration(locs)) continue;
    warnings.push(`Duplicate ID '${id}' in: ${locs.join(", ")}`);
  }

  for (const r of allRefs) {
    if (CATALOG_REF_RE.test(r.value)) continue;
    if (!allIds.has(r.value)) {
      crossErrors.push(`Missing reference '${r.value}' at ${r.loc}`);
    }
  }

  // Gap warnings and typed-id warnings are emitted in ONE per-file pass, so all findings for a
  // file appear together and in file order. Consumers render this array verbatim, which makes
  // its order part of the contract.
  const sliceNames = declaredSlices(parsedFiles);

  for (const { relFile, schemaType, data } of parsedFiles) {
    if (schemaType === "domain" && data?.operations) {
      for (const [key, op] of Object.entries(data.operations)) {
        const missingExchange = eventsExemptFromExchange
          ? (op.kind === "command" || op.kind === "query") && !op.exchange && op.dispatch !== "in-process"
          : !op.exchange;
        if (missingExchange) {
          warnings.push(`[${relFile}] Operation "${key}" (${op.id ?? "no-id"}) has no exchange block`);
        }
      }
    }

    if (schemaType === "arch" && data?.parties) {
      for (const party of data.parties) {
        if (!party.contexts) continue;
        for (const context of party.contexts) {
          if (!context.services) continue;
          for (const service of context.services) {
            if (!service.contracts) {
              warnings.push(
                `[${relFile}] Service "${service.name}" in party "${party.name}" has no contracts block`,
              );
              continue;
            }
            for (const [kind, contract] of Object.entries(service.contracts)) {
              const finding = checkContractOutputSlice(
                relFile, service.name, kind, contract?.output, sliceNames,
              );
              if (finding) warnings.push(finding);
            }
          }
        }
      }
    }

    if (schemaType === "infrastructure" && data && typeof data === "object") {
      for (const { key, kind, expected, re } of TYPED_ID) {
        if (!Array.isArray(data[key])) continue;
        for (const item of data[key]) {
          // A string item under `environments` is a legacy env-NAME, not a typed entity — skip.
          if (!item || typeof item !== "object") continue;
          if (typeof item.id === "string" && !re.test(item.id)) {
            warnings.push(
              `[${relFile}] ${kind} id "${item.id}" SHOULD match ${expected} (v2.7.7 typed-id convention, RD25) — free-string is valid but discouraged; required in v2.8`,
            );
          }
        }
      }
    }
  }

  // Deployment-scope hierarchy. `scope_ref` and `target_scope.ref` resolvability is already
  // covered by the generic cross-ref walk; these two need the scope GRAPH:
  //   - dangling `parent` → Cross-Reference Error (`parent` is not a generic ref key)
  //   - a cycle in the `parent` chain → schema-level ERROR (it must be a tree)
  const scopeParent = new Map(); // scopeId → parentId (only scopes that declare a parent)
  const scopeLoc = new Map(); // scopeId → relFile (every declared scope)
  for (const { relFile, schemaType, data } of parsedFiles) {
    if (schemaType !== "infrastructure" || !data || !Array.isArray(data.deployment_scopes)) continue;
    for (const scope of data.deployment_scopes) {
      if (!scope || typeof scope !== "object" || typeof scope.id !== "string") continue;
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

  // Compat mode: demote schema errors to warnings — EXCEPT identity and reference violations,
  // which stay fatal because a model missing them is not merely out of date, it is unusable.
  if (args.compat && schemaErrors.length > 0) {
    const retained = schemaErrors.filter((e) => nonDemotable.has(e));
    const demoted = schemaErrors.filter((e) => !nonDemotable.has(e));
    if (demoted.length > 0) {
      warnings.push(
        ...demoted.map((e) => `Compat schema warning: ${e}`),
        "Compat mode active: schema violations are non-fatal.",
      );
    }
    if (retained.length > 0) {
      warnings.push(
        `Compat mode does NOT relax ${retained.length} identity/reference violation(s) — these remain fatal.`,
      );
    }
    schemaErrors.length = 0;
    schemaErrors.push(...retained);
  }

  return { schemaErrors, crossErrors, warnings, modelPath: modelDir, filesValidated, filesSkipped };
}
