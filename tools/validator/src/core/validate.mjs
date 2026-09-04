import fs from "node:fs";
import path from "node:path";
import { toPosixPath, walkFiles, loadYaml } from "./utils.mjs";
import { loadSchemaRegistry, makeAjv, SCHEMA_BASE_URI } from "./schema-registry.mjs";
import { deriveReferenceKeys } from "./reference-keys.mjs";
import { FILENAME_TO_SCHEMA, detectSchemaType } from "./schema-types.mjs";
import {
  collectIds,
  collectKeyedIds,
  collectParentEdges,
  collectRefs,
  collectSelfEdges,
  findParentCycles,
  isIdentityOrReferenceViolation,
  isPartyRedeclaration,
} from "./references.mjs";
import { SECTION_TO_CATEGORY, resolvesAgainst } from "./model-ref-match.mjs";

/** `RT###` refs point to the resource-type CATALOG in the profiles, never into the model. */
const CATALOG_REF_RE = /^([a-z][a-z0-9-]*\.)?RT\d{3,}$/;

/**
 * v2.7.7 typed-id conventions, warned about below v2.8 and enforced by the schema from v2.8.
 *
 * Before v2.8 a free-string id is schema-VALID and this warning is the only thing that says
 * anything about it. From v2.8 the schema holds each of these ids to its typed pattern, so the
 * same fact arrives as an ERROR from Ajv - and the branch below stops warning, because a warning
 * saying a value is "valid but discouraged" beside an error rejecting it states the opposite of
 * what the run just decided. One fact, one severity, whichever version is in force.
 */
const TYPED_ID = [
  { key: "resources", kind: "Infrastructure resource", expected: "IR###", re: /^([a-z][a-z0-9-]*\.)?IR\d{3,}$/ },
  { key: "environments", kind: "Environment", expected: "ENV###", re: /^([a-z][a-z0-9-]*\.)?ENV\d{3,}$/ },
  { key: "bindings", kind: "Binding", expected: "BND###", re: /^([a-z][a-z0-9-]*\.)?BND\d{3,}$/ },
  { key: "deployment_scopes", kind: "Deployment scope", expected: "DSC###", re: /^([a-z][a-z0-9-]*\.)?DSC\d{3,}$/ },
];

/**
 * A version named as a whole PATH SEGMENT: `.blueprint/v2.6`, `schemas/blueprint/v2`. The minor is
 * optional, because the legacy directories carry none (`v1`, `v2`) and a directory that names only
 * a major still names a major.
 *
 * Anchored on a separator and a literal `v` deliberately. A pattern that accepted bare digits would
 * read a version out of any path holding a number - a build id, a temp directory, a port - and be
 * wrong silently, which is the failure mode this whole function exists to remove.
 */
const VERSION_SEGMENT = /(?:^|[/\\])v(\d+)(?:\.(\d+))?(?=[/\\]|$)/g;

/** The LAST such segment, since the version directory is the deepest part of a model path. */
function versionFromPath(value) {
  if (typeof value !== "string") return null;
  let found = null;
  for (const match of value.matchAll(VERSION_SEGMENT)) {
    found = { major: Number(match[1]), minor: match[2] === undefined ? 0 : Number(match[2]) };
  }
  return found;
}

/**
 * The schema version a run is operating under.
 *
 * `args.schemaVersion` is consulted FIRST and is how the CLI supplies the version it resolved -
 * which may come from the model's own `schemaVersion:` declaration rather than from a path. A model
 * filed under a directory that names only a major (`.blueprint/v2`) while declaring `2.4.0` is
 * a 2.4 model: the declaration is the more specific fact, and the directory is a filing convention.
 * The path sources below remain for callers that reach the core directly.
 *
 * Returns null when nothing declares one, and `atLeast` then assumes current semantics.
 */
function detectSchemaVersion(args) {
  const supplied = args.schemaVersion;
  // The CLI supplies {major, minor}; a direct caller may pass a bare string ("2.7", "v2.7"). Both
  // are a STATEMENT of the version, so neither is parsed as a path.
  if (supplied && typeof supplied === "object" && Number.isFinite(supplied.major)) {
    return { major: supplied.major, minor: Number.isFinite(supplied.minor) ? supplied.minor : 0 };
  }
  if (typeof supplied === "string") {
    const bare = /^v?(\d+)(?:\.(\d+))?/.exec(supplied.trim());
    if (bare) return { major: Number(bare[1]), minor: bare[2] === undefined ? 0 : Number(bare[2]) };
  }
  for (const source of [args.model, args.schemas]) {
    const found = versionFromPath(source);
    if (found) return found;
  }
  return null;
}

/**
 * `a >= b` over {major, minor}.
 *
 * ONE rule branches on this today, and that is a deliberate state rather than an unfinished one.
 * Before adding a second, apply the test that settled the two candidates examined on 2026-09-02:
 *
 *   Did the version's OWN schema declare the thing being checked?
 *     YES -> a validator that missed it had a DEFECT. Fix it for every version; no branch.
 *            (`operations[]`/`concepts[]` are `operation_ref[]`/`concept_ref[]` in
 *             `governance/capability.schema.yaml:60-73` as far back as v2.2, so walking them is
 *             retroactive correctness, not a new rule.)
 *     NO  -> the rule is newer than the model and needs a branch here.
 *
 * A third possibility is worth naming because it caught out the first attempt: the rule may have an
 * unstated PRECONDITION rather than a version boundary. The contract-output-slice rule looked
 * version-specific because one per-version copy carried it and another did not; measured, it fired
 * identically at v2.6 and v2.7 and its real precondition was "the model declares slices at all".
 * Check that before reaching for a version number.
 */
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
  // A model that declares NO slices cannot commit the defect above: with no vocabulary, no prefix
  // can look like a slice and fail to be one. Firing here produced an unactionable warning - "use
  // <slice>/<name>" told to a model that has no slices - and it was the ONLY thing this rule ever
  // said. Measured 2026-09-02 over the whole corpus: 82 of 82 findings landed on models declaring
  // zero slices, none against a real vocabulary, across v2, v2.6 AND v2.7 alike. So this is not a
  // version boundary; it is a precondition the rule always had and never stated.
  if (slices.size === 0) return null;
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

/**
 * Every contract `output:` the model declares, across all services.
 *
 * The counterpart vocabulary to `declaredSlices`: where that one answers "is this prefix a slice",
 * this answers "is this path a contract this model actually produces".
 */
export function declaredContractOutputs(parsedFiles) {
  const outputs = new Set();
  for (const { schemaType, data } of parsedFiles) {
    if (schemaType !== "arch" || !Array.isArray(data?.parties)) continue;
    for (const party of data.parties) {
      for (const context of party?.contexts ?? []) {
        for (const service of context?.services ?? []) {
          for (const contract of Object.values(service?.contracts ?? {})) {
            if (contract && typeof contract.output === "string") outputs.add(contract.output);
          }
        }
      }
    }
  }
  return outputs;
}

/**
 * Check a test case's `contract.file` against the contract outputs the model declares.
 *
 * The CONSUMER side of the path `checkContractOutputSlice` guards on the producer side. A test case
 * says "I validate against this contract"; the arch layer says where that contract is written. Until
 * 2026-08-27 nothing compared the two, and the field is a plain string with no schema constraint
 * beyond being one - so all 10 of prestashop's pointed at a `dist/` directory that no arch block, no
 * render manifest and no renderer declared, and every gate stayed green. Correcting them moved no
 * measurement, which is the tell that nothing was ever asking.
 *
 * Warning, never an error, and it reports the EMPTY case separately: a model that declares no
 * contract outputs at all is a different statement from one whose declared outputs do not include
 * this path, and collapsing the two would let "nothing to compare against" read as "compared and
 * fine".
 */
export function checkTestCaseContractFile(relFile, testCaseId, file, outputs) {
  if (typeof file !== "string" || file.trim() === "") return null;
  if (outputs.has(file)) return null;
  const who = `[${relFile}] Test case "${testCaseId ?? "no-id"}" names contract file "${file}"`;
  if (outputs.size === 0) {
    return (
      `${who}, but this model declares no contract outputs at all - nothing produces that file, ` +
      `so the reference cannot be satisfied by anything in the model.`
    );
  }
  const known = [...outputs].sort().join(", ");
  return (
    `${who}, which no service declares as a contract output - the test validates against an ` +
    `artifact the model never produces. Declared outputs: ${known}.`
  );
}

/**
 * Every model component the blueprint declares, in the shape the shared `model_ref` form rules take.
 *
 * Walks the three `components.*` sections a blueprint materializes. `x-model-id` is carried so a
 * form-1 reference resolves here exactly as it does in the graph builder.
 */
export function declaredModelComponents(parsedFiles) {
  const components = [];
  for (const { relFile, data } of parsedFiles) {
    const sections = data?.components;
    if (!sections || typeof sections !== "object") continue;
    for (const [section, category] of Object.entries(SECTION_TO_CATEGORY)) {
      const entries = sections[section];
      if (!entries || typeof entries !== "object") continue;
      for (const [name, item] of Object.entries(entries)) {
        const modelId = item && typeof item === "object" ? item["x-model-id"] : undefined;
        components.push({
          name,
          category,
          modelId: typeof modelId === "string" ? modelId : undefined,
          file: relFile,
        });
      }
    }
  }
  return components;
}

/**
 * Check an operation's `payload.schema` against the components the model declares.
 *
 * `payload.schema` is a `model_ref` and cannot go through the generic reference walk: that walk
 * records a reference only when the value looks like a TYPED ID, and three of the four documented
 * forms are not typed ids. Nor can `schema` become a generic reference key - it is the commonest key
 * in a JSON Schema body, where it means a type definition rather than a reference.
 *
 * The form rules are NOT reimplemented here. `model-ref-match.mjs` is emitted from the module the
 * graph builder imports, so the validator and the builder cannot disagree about what a reference
 * addresses - which matters, because the semantic rule `payload-schema-unresolved` reports the same
 * defect from the graph side, and two definitions of "resolves" would make the two contradict each
 * other on the same file.
 *
 * Warning rather than error: a dangling reference is the same class as a missing typed-id reference,
 * which IS an error, but promoting it would hard-fail existing models on upgrade. Promotion is its
 * own decision, as `unbound-operation`'s was.
 */
export function checkPayloadSchemaResolvable(relFile, operationKey, operationId, ref, components) {
  if (typeof ref !== "string" || ref.trim() === "") return null;
  if (resolvesAgainst(ref, components)) return null;
  return (
    `[${relFile}] Operation "${operationKey}" (${operationId ?? "no-id"}) has \`payload.schema: ` +
    `${ref}\` and no model component answers it - declare it under \`components.schemas\` ` +
    `(or \`x-field\` / \`x-parameter\`) in a models file, or correct the reference.`
  );
}

/**
 * The message a schema error prints.
 *
 * Two of Ajv's default messages name no subject: a rejected extra property is reported
 * as "must NOT have additional properties" without saying which one, and a value outside
 * an enum as "must be equal to one of the allowed values" without listing them. Both
 * facts are already computed and sit in the error's `params`, so they are appended here.
 * Every other message already names its subject and passes through unchanged.
 *
 * The allowed values are printed in full. A reader who hits an enum error needs the value
 * they meant, and shortening the list hides exactly the candidate that ends the search.
 */
function describeError(rawError) {
  const base = rawError.message ?? "schema error";
  const params = rawError.params;
  if (!params) return base;
  if (rawError.keyword === "additionalProperties" && typeof params.additionalProperty === "string") {
    return `${base}: ${params.additionalProperty}`;
  }
  if (rawError.keyword === "enum" && Array.isArray(params.allowedValues)) {
    return `${base}: ${params.allowedValues.join(", ")}`;
  }
  return base;
}

export function validateModel(args) {
  const { registry } = loadSchemaRegistry(args.schemas);
  const ajv = makeAjv(registry);
  // Which keys hold a reference is read off THIS schema tree, so the walk below resolves exactly
  // the references the declared version types - see reference-keys.mjs for why it is not a list.
  const refKeys = deriveReferenceKeys(registry);

  // Rules are not uniform across schema versions, so behaviour follows the version the model
  // DECLARES rather than the newest one this validator knows. From v2.7, only invocable
  // operations (commands and queries) need a wire binding — events are domain facts and are
  // exempt, and `dispatch: in-process` is intentionally transport-less. Before v2.7 every
  // operation was expected to carry an `exchange` block, so a v2.6 model is still held to that.
  const version = detectSchemaVersion(args);
  const eventsExemptFromExchange = atLeast(version, 2, 7);
  // From v2.8 the infrastructure id fields carry their typed patterns, so Ajv rejects what this
  // warning used to describe. See TYPED_ID above for why both must never fire on one value.
  const typedIdsEnforcedBySchema = atLeast(version, 2, 8);

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
  const parentEdges = new Map();
  const selfEdges = [];
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
    collectParentEdges(data, parentEdges);
    collectSelfEdges(data, selfEdges, null, [relFile]);
    // Each ref carries the scope ITS OWN file declares, so a bare id can be resolved against
    // that scope and only that one. Tagging at the call site keeps `collectRefs` unchanged.
    const declaredScope = typeof data.scope === "string" ? data.scope : null;
    // Format-2 names (`orders:placeOrder`) are declared by the map entries of a scoped document.
    // The scope is the declared one, else the folder the file sits in - the same fallback the
    // model loader applies, so a reference resolves here iff the builder resolves it.
    const folderScope = relFile.includes("/") ? relFile.slice(0, relFile.indexOf("/")) : null;
    collectKeyedIds(data, declaredScope ?? folderScope, allIds, [relFile]);
    for (const ref of collectRefs(data, [], [relFile], refKeys)) {
      allRefs.push({ ...ref, scope: declaredScope });
    }

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
        const text = `[${relFile}] ${at} -> ${describeError(rawError)}`;
        schemaErrors.push(text);
        if (isIdentityOrReferenceViolation(rawError.instancePath, rawError.message, refKeys)) {
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
    if (allIds.has(r.value)) continue;
    // The scope prefix is OPTIONAL by schema (`^([a-z][a-z0-9-]*\.)?CN\d{3}$` and its siblings),
    // so a bare id inside a scoped file names that file's own scope. It is resolved against THAT
    // scope alone, never against every scope: a bare id is ambiguous across contexts, and a
    // search that accepted any match would resolve a typo to whichever slice happened to own it.
    if (!r.value.includes(".") && r.scope && allIds.has(`${r.scope}.${r.value}`)) continue;
    crossErrors.push(`Missing reference '${r.value}' at ${r.loc}`);
  }

  // A `parent` ring resolves perfectly and still breaks every consumer that walks it, so reference
  // checking above cannot see it and this is where it is caught. Collected across the whole model
  // rather than per file, because a chain may cross files.
  //
  // ONE implementation for every construct that uses `parent`. A department's parent department and
  // a deployment scope's parent scope are the same shape and the same defect, and the dangling half
  // is now the generic reference walk's job because `parent` is a reference key. A cycle is a
  // cross-reference error rather than a schema error, so `--compat` cannot demote it: a chain that
  // does not terminate is not a version-compatibility question.
  for (const cycle of findParentCycles(parentEdges)) {
    crossErrors.push(
      cycle.length === 1
        ? `'${cycle[0]}' is its own parent`
        : `Parent cycle: ${[...cycle, cycle[0]].join(" -> ")}`,
    );
  }

  // The same blind spot one construct over: an edge naming its own declarer resolves, so the walk
  // above passes it. A cross-reference error rather than a warning, because the entry states a
  // relationship that does not exist - a unit cannot depend on, supply or be hosted on itself.
  for (const edge of selfEdges) {
    crossErrors.push(`'${edge.id}' declares an edge to itself at ${edge.loc}`);
  }

  // Gap warnings and typed-id warnings are emitted in ONE per-file pass, so all findings for a
  // file appear together and in file order. Consumers render this array verbatim, which makes
  // its order part of the contract.
  const sliceNames = declaredSlices(parsedFiles);
  const contractOutputs = declaredContractOutputs(parsedFiles);
  const modelComponents = declaredModelComponents(parsedFiles);

  for (const { relFile, schemaType, data } of parsedFiles) {
    if (schemaType === "domain" && data?.operations) {
      for (const [key, op] of Object.entries(data.operations)) {
        const payloadFinding = checkPayloadSchemaResolvable(
          relFile, key, op.id, op.payload?.schema, modelComponents,
        );
        if (payloadFinding) warnings.push(payloadFinding);
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

    if (schemaType === "test-cases" && data && typeof data === "object") {
      for (const group of ["happy_path", "edge_cases", "error_cases"]) {
        for (const testCase of Array.isArray(data[group]) ? data[group] : []) {
          if (!testCase || typeof testCase !== "object") continue;
          const finding = checkTestCaseContractFile(
            relFile, testCase.id, testCase.contract?.file, contractOutputs,
          );
          if (finding) warnings.push(finding);
        }
      }
    }

    if (schemaType === "infrastructure" && !typedIdsEnforcedBySchema && data && typeof data === "object") {
      for (const { key, kind, expected, re } of TYPED_ID) {
        if (!Array.isArray(data[key])) continue;
        for (const item of data[key]) {
          // A string item under `environments` is a legacy env-NAME, not a typed entity — skip.
          if (!item || typeof item !== "object") continue;
          if (typeof item.id === "string" && !re.test(item.id)) {
            warnings.push(
              `[${relFile}] ${kind} id "${item.id}" SHOULD match ${expected} (v2.7.7 typed-id convention) — free-string is valid but discouraged; required in v2.8`,
            );
          }
        }
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
