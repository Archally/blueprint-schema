import fs from "node:fs";
import path from "node:path";
import { toPosixPath, walkFiles, loadYaml } from "./utils.mjs";
import { loadSchemaRegistry, makeAjv, SCHEMA_BASE_URI } from "./schema-registry.mjs";
import { deriveReferenceKeys } from "./reference-keys.mjs";
import { resolveModelReferences } from "./cross-references.mjs";
import {
  retiredBandTable,
  retiredBandMessage,
  declaredBandTable,
  bandDeclarationMessages,
  outOfBandMessage,
} from "./id-bands.mjs";
import { archContextsOf, servicesOf } from "./arch-shape.mjs";
import { FILENAME_TO_SCHEMA, detectSchemaType } from "./schema-types.mjs";
import { isIdentityOrReferenceViolation } from "./references.mjs";
import { SECTION_TO_CATEGORY, resolvesAgainst } from "./model-ref-match.mjs";

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
 * Every contract document the model declares, across all services, in EITHER spelling.
 *
 * The counterpart vocabulary to `declaredSlices`: where that one answers "is this prefix a slice",
 * this answers "is this a contract this model actually produces". A model mid-migration declares
 * some contracts by `contract_name` and some by the superseded `output:`, so both belong in the set
 * - a consumer naming one of them is naming a real document either way.
 */
export function declaredContractOutputs(parsedFiles) {
  const outputs = new Set();
  for (const { schemaType, data } of parsedFiles) {
    if (schemaType !== "arch") continue;
    for (const declared of archContextsOf(data)) {
      for (const [service] of servicesOf(declared)) {
        for (const contract of Object.values(service?.contracts ?? {})) {
          if (!contract) continue;
          if (typeof contract.output === "string") outputs.add(contract.output);
          if (typeof contract.contract_name === "string") outputs.add(contract.contract_name);
        }
      }
    }
  }
  return outputs;
}

/**
 * A contract still naming its document with the superseded `output:`.
 *
 * Warning, never an error: `output:` is accepted for the whole v2.8 line, and a model that has not
 * migrated is correct, not broken. What the warning buys is that the removal does not arrive as a
 * surprise - it names the replacement and the line the field goes away in, so the reader can act
 * before then rather than after.
 */
export function checkDeprecatedContractOutput(relFile, serviceName, kind, contract) {
  if (!contract || typeof contract.output !== "string" || contract.output.trim() === "") return null;
  return (
    `[${relFile}] Service "${serviceName}" ${kind} names its contract with \`output\`, which is ` +
    `superseded - state the name, the placement and the serialization separately instead: ` +
    `\`contract_name\` names the document, \`slice\` or \`cross_cutting\` places it, and the contract ` +
    `kind selects the format. Accepted until the next major line.`
  );
}

/**
 * A service on the 2.8 line still naming its operations with `handles:`.
 *
 * The schema rejects the key outright, so this is guidance beside a schema error rather than a
 * finding of its own: Ajv says the object has a property it may not have, and this says which
 * property to write instead. The two are not a homonym - one names the rule broken, the other names
 * the edit.
 *
 * Silent below 2.8, and that is the whole reason it is gated. `handles:` is CURRENT on the earlier
 * lines and `contracts.inprocess.provide` is a 2.8 key, so an unguarded check tells a v2.7 author to
 * write a field their own schema rejects - it did, 19 times on one model and 8 on another.
 */
/**
 * Does this `dispatch` value say the operation executes in-process?
 *
 * One concept, two accepted spellings: `inprocess` is current and `in-process` is read for the
 * rest of the 2.8 line. Every check that turns on the value asks here, so a model that migrates
 * between them keeps whatever the value bought it.
 */
export function isInProcess(dispatch) {
  return dispatch === "inprocess" || dispatch === "in-process";
}

export function checkDeprecatedServiceHandles(relFile, serviceName, service) {
  if (!service || !Array.isArray(service.handles) || service.handles.length === 0) return null;
  return (
    `[${relFile}] Service "${serviceName}" names its operations with \`handles\`, which this line ` +
    `does not declare. Write them under \`contracts.inprocess.provide\` - same binding, and it also ` +
    `says which coupling they belong to. \`handles\` named who provides the operation and how it is ` +
    `invoked at once, and the second of those is \`dispatch\` on the operation.`
  );
}

/**
 * An activity still naming its successors with the superseded `next_activities:`.
 *
 * Warning, never an error, for the reason the two deprecation checks above are: the key is accepted
 * for the whole v2.8 line and means exactly what it meant, so a model that has not migrated is
 * correct rather than broken. `next` says the same thing and can also say what chooses between two
 * branches, which the older key has no room for.
 *
 * One finding per ACTIVITY, so the count is the number of places an author would edit. And only on
 * the 2.8 line: `next` is a v2.8 key, so telling a v2.7 model to use it would name a field its own
 * schema rejects.
 */
export function checkDeprecatedNextActivities(relFile, processId, activity) {
  if (!activity || !Array.isArray(activity.next_activities) || activity.next_activities.length === 0) {
    return null;
  }
  const where = activity.id ? `Activity "${activity.id}"` : "An activity";
  return (
    `[${relFile}] ${where} of process "${processId}" names its successors with ` +
    `\`next_activities\`, which is superseded by \`next\` - same successors, and a \`condition\` ` +
    `per branch saying what takes it. Accepted until the next major line.`
  );
}

/**
 * A context dependency still naming its integration with the superseded free-string `type:`.
 *
 * Warning rather than error, like the two above: the key is accepted for the whole 2.8 line and
 * means what it always meant. What `coupling` adds is comparability - it takes the same six values
 * the contract surface computes, so a declared coupling and a derived one can be set against each
 * other, which a free string never could.
 *
 * One finding per DEPENDENCY ENTRY, so the count is the number of places an author would edit.
 * The message names the mapped value where one exists and says so plainly where it does not: three
 * of the corpus spellings name a medium rather than a coupling, and guessing for them would put a
 * word in the model that no one chose.
 *
 * Only on the 2.8 line, because `coupling` is a v2.8 key and an earlier model told to write it
 * would be told to write a field its own schema rejects.
 */
const COUPLING_FOR_TYPE = Object.freeze({
  api: "http",
  http: "http",
  rest: "http",
  events: "message",
  event: "message",
  messaging: "message",
  grpc: "rpc",
  rpc: "rpc",
  "shared-db": "shareddata",
  shared_db: "shareddata",
  database: "shareddata",
});

export function checkDeprecatedDependencyType(relFile, contextName, dependency) {
  if (!dependency || typeof dependency.type !== "string" || dependency.type.trim() === "") return null;
  const authored = dependency.type.trim();
  const mapped = COUPLING_FOR_TYPE[authored.toLowerCase()];
  const advice = mapped
    ? `Write \`coupling: ${mapped}\` instead.`
    : `\`coupling\` has no value for it - "${authored}" names a medium rather than a coupling, so ` +
      `which of the six applies is a decision only an author can make.`;
  return (
    `[${relFile}] Context "${contextName}" states its dependency on "${dependency.name}" with ` +
    `\`type: ${authored}\`, which is superseded by \`coupling\`. ${advice} Where the contracts ` +
    `already reach this pair, declare neither: they carry the direction, the operations and the ` +
    `broker as well. Accepted until the next major line.`
  );
}

/**
 * A contract's declared `slice:` against the slice vocabulary.
 *
 * Unlike the prefix rule below it, this one does NOT exempt a model that declares no slices. A
 * prefix inside a path is ambiguous - it may always have been a subdirectory - so with no
 * vocabulary there is nothing for it to be mistaken for. A `slice:` is not ambiguous: the author
 * named a slice, and a model declaring none disagrees with that outright. Reporting it is the only
 * thing that distinguishes the disagreement from correct placement.
 */
export function checkContractSlice(relFile, serviceName, kind, slice, slices) {
  if (typeof slice !== "string" || slice.trim() === "") return null;
  if (slices.has(slice)) return null;
  const known = [...slices].sort().join(", ") || "(none declared)";
  return (
    `[${relFile}] Service "${serviceName}" ${kind} places its contract in slice "${slice}", ` +
    `which this model does not declare. Declared slices: ${known}. Declare it under ` +
    `\`layout.slices\`, or use \`cross_cutting: true\` if the contract belongs to no single slice.`
  );
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
 * Check one `model_ref` field on an operation against the components the model declares.
 *
 * A `model_ref` field cannot go through the generic reference walk: that walk records a reference
 * only when the value looks like a TYPED ID, and three of the four documented forms are not typed
 * ids. Nor can `schema` become a generic reference key - it is the commonest key in a JSON Schema
 * body, where it means a type definition rather than a reference. `fieldPath` names the field so the
 * message can point at the one that is wrong, since an operation carries several of these
 * (`payload.schema`, `exchange.endpoint.parameters[].schema`, `responses[].schema`, and their RPC
 * and header counterparts) and a reader needs to know which one to fix.
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
export function checkModelRefResolvable(relFile, operationKey, operationId, fieldPath, ref, components) {
  if (typeof ref !== "string" || ref.trim() === "") return null;
  if (resolvesAgainst(ref, components)) return null;
  return (
    `[${relFile}] Operation "${operationKey}" (${operationId ?? "no-id"}) has \`${fieldPath}: ` +
    `${ref}\` and no model component answers it - declare it under \`components.schemas\` ` +
    `(or \`x-field\` / \`x-parameter\`) in a models file, or correct the reference.`
  );
}

/** `payload.schema` specifically - kept as its own name because it is the one call site with an existing test suite. */
export function checkPayloadSchemaResolvable(relFile, operationKey, operationId, ref, components) {
  return checkModelRefResolvable(relFile, operationKey, operationId, "payload.schema", ref, components);
}

/**
 * Every OTHER `model_ref` field an operation can carry, walked and checked the same way.
 *
 * `payload.schema` is one of six sites `domain.schema.yaml` types as `model_ref` on an operation;
 * the other five sit under `exchange` (single object or array, per the oneOf) and `responses`:
 * a path/query parameter's `schema`, an RPC method parameter's `schema`, an RPC method result's
 * `schema`, a response's `schema`, and a response header's `schema`. None of these were checked -
 * `ecommerce`'s `orders.QRY002` points its `status` parameter at `#/components/x-enum/OrderStatus`,
 * a section this schema line does not materialize (the component lives under `x-field`), and
 * nothing reported it: the generic reference walk skips `schema` keys on purpose (see above), and
 * only `payload.schema` had a dedicated check.
 *
 * Returns every finding for the operation, in the order the fields appear in the schema, so output
 * order stays deterministic file-over-file the way the rest of this pass already is.
 */
export function checkOperationModelRefs(relFile, operationKey, operationId, op, components) {
  const findings = [];
  const add = (fieldPath, ref) => {
    const finding = checkModelRefResolvable(relFile, operationKey, operationId, fieldPath, ref, components);
    if (finding) findings.push(finding);
  };

  const exchanges = Array.isArray(op?.exchange) ? op.exchange : op?.exchange ? [op.exchange] : [];
  for (const exchange of exchanges) {
    for (const parameter of exchange?.endpoint?.parameters ?? []) {
      add(`exchange.endpoint.parameters[${parameter?.name ?? "?"}].schema`, parameter?.schema);
    }
    for (const parameter of exchange?.method?.parameters ?? []) {
      add(`exchange.method.parameters[${parameter?.name ?? "?"}].schema`, parameter?.schema);
    }
    if (exchange?.method?.result) {
      add("exchange.method.result.schema", exchange.method.result.schema);
    }
  }

  for (const response of op?.responses ?? []) {
    add(`responses[${response?.code ?? "?"}].schema`, response?.schema);
    for (const header of response?.headers ?? []) {
      add(`responses[${response?.code ?? "?"}].headers[${header?.name ?? "?"}].schema`, header?.schema);
    }
  }

  return findings;
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

/** The schema that describes a tracked migration register, by its registry name. */
const TRACKED_REGISTER_SCHEMA = "tracked-migrations.schema.yaml";

/**
 * Check a project's tracked migration register, which sits BESIDE the model rather than inside it.
 *
 * A project in tracked mode stages its changes into `.blueprint/migrations.yaml`, one level above
 * the model directory. Nothing in the model walk reaches that path, so the register was checked by
 * nothing: a register carrying a status no tool accepts read exactly like a correct one.
 *
 * The caller supplies the path because only the caller knows where the project is. This function
 * supplies the verdict, using the same Ajv instance and the same message shape as every other
 * document, so a finding here reads like a finding anywhere else.
 *
 * A schema line that does not describe the register yields a WARNING naming it, never silence and
 * never an error: an older model is not wrong for predating a document type.
 *
 * @returns {{ path: string, entries: number | null, checked: boolean }} what was examined
 */
function checkTrackedRegister({ registerPath, modelDir, ajv, schemaErrors, warnings }) {
  // Named relative to the model where that is short enough to read - the register sits one level
  // above it - and absolutely otherwise. A path that climbs out of the tree tells a reader less
  // than the path they passed in.
  const relative = toPosixPath(path.relative(modelDir, registerPath));
  const rel = relative.startsWith("../../") ? toPosixPath(registerPath) : relative;
  let data;
  try {
    data = loadYaml(registerPath);
  } catch (err) {
    schemaErrors.push(`[${rel}] Parse error: ${err.message}`);
    return { path: registerPath, entries: null, checked: false };
  }

  const validate = ajv.getSchema(SCHEMA_BASE_URI + TRACKED_REGISTER_SCHEMA);
  if (!validate) {
    warnings.push(`[${rel}] No validator for a tracked migration register in this schema version`);
    return { path: registerPath, entries: Array.isArray(data) ? data.length : null, checked: false };
  }

  if (!validate(data)) {
    for (const rawError of validate.errors ?? []) {
      const at = rawError.instancePath ? rawError.instancePath : "/";
      schemaErrors.push(`[${rel}] ${at} -> ${describeError(rawError)}`);
    }
  }
  return { path: registerPath, entries: Array.isArray(data) ? data.length : null, checked: true };
}

export function validateModel(args) {
  const { registry } = loadSchemaRegistry(args.schemas);
  // Which id bands this schema line retires is the line's own statement, so a model checked against
  // an earlier tree is told nothing about bands that tree never retired.
  const bandTable = retiredBandTable(registry);
  const ajv = makeAjv(registry);
  // Which keys hold a reference is read off THIS schema tree, so the walk below resolves exactly
  // the references the declared version types - see reference-keys.mjs for why it is not a list.
  const refKeys = deriveReferenceKeys(registry);

  // Rules are not uniform across schema versions, so behaviour follows the version the model
  // DECLARES rather than the newest one this validator knows. From v2.7, only invocable
  // operations (commands and queries) need a wire binding — events are domain facts and are
  // exempt, and an operation whose `dispatch` says in-process is intentionally transport-less.
  // Both spellings of that value carry the exemption: `inprocess` is the current one and
  // `in-process` is accepted for the rest of the 2.8 line, and an exemption that recognised only
  // one of them would start warning about a model the moment it migrated. Before v2.7 every
  // operation was expected to carry an `exchange` block, so a v2.6 model is still held to that.
  const version = detectSchemaVersion(args);
  const eventsExemptFromExchange = atLeast(version, 2, 7);
  const nextSupersedesNextActivities = atLeast(version, 2, 8);
  // `handles:` is a property the 2.8 schema no longer declares, and the earlier lines still do.
  const handlesRemovedFromSchema = atLeast(version, 2, 8);
  // `coupling` is a v2.8 key. Telling an earlier model to write it would name a field its own
  // schema rejects, which is the defect this file has now been bitten by twice.
  const couplingSupersedesDependencyType = atLeast(version, 2, 8);
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
  /**
   * Each recognised file is parsed exactly once and reused by every later pass, so the passes
   * cannot disagree about the same file and warning order stays deterministic.
   */
  const parsedFiles = [];
  let filesValidated = 0;
  /**
   * Every file the run did not schema-check, by name. A count alone says how many documents went
   * unchecked but not which, and the two readings differ: a skipped deployment manifest is routine,
   * a skipped model file is a gap. The count reported to callers is this list's length, so the two
   * cannot disagree.
   */
  const skippedFiles = [];

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
        skippedFiles.push(relFile);
      }
      continue;
    }
    if (!data || typeof data !== "object") continue;

    // Every readable YAML document takes part in reference integrity, whether or not a schema
    // recognises its filename. A file the schema map does not cover still declares ids and still
    // points at other entities — skipping it would silently narrow the graph and let dangling
    // references through unreported.
    parsedFiles.push({ relFile, schemaType, data });

    // Schema validation, on the other hand, needs a schema. Unrecognised files are counted as
    // skipped and reported as such, never validated against an unrelated schema.
    if (!schemaRelPath) { skippedFiles.push(relFile); continue; }

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

  // Every readable document takes part, and the findings are structured so the model server can
  // render the same ones - one implementation of "does this reference resolve", two surfaces.
  // A cycle and a self edge are cross-reference errors rather than schema errors, so `--compat`
  // cannot demote them: a chain that does not terminate is not a version-compatibility question.
  // What the MODEL reserves, as opposed to what the SCHEMA LINE retires. Empty for every model
  // that declares no band, which is what keeps the whole check opt-in.
  const declaredBands = declaredBandTable(parsedFiles);
  const references = resolveModelReferences(parsedFiles, refKeys, bandTable, declaredBands);
  for (const { id, locations } of references.duplicates) {
    warnings.push(`Duplicate ID '${id}' in: ${locations.join(", ")}`);
  }
  for (const finding of references.retiredBands) {
    warnings.push(retiredBandMessage(finding, bandTable));
  }
  // Answerable from the declaration alone, so it is reported even by a model with no ids yet.
  for (const message of bandDeclarationMessages(declaredBands)) warnings.push(message);
  for (const finding of references.outOfBand) {
    warnings.push(outOfBandMessage(finding, finding.file));
  }
  for (const { value, loc } of references.missing) {
    crossErrors.push(`Missing reference '${value}' at ${loc}`);
  }
  // A `domain_ref` that resolves to nothing is a dangling reference like any other, and it is the
  // one membership statement that CAN be wrong: an omitted or folder-inferred context is correct
  // behaviour, while a named domain the model never declares is not.
  for (const { context, ref, loc } of references.unresolvedDomainRefs) {
    crossErrors.push(`Context '${context}' declares domain_ref '${ref}', which this model does not declare, at ${loc}`);
  }
  for (const cycle of references.parentCycles) {
    crossErrors.push(
      cycle.length === 1
        ? `'${cycle[0]}' is its own parent`
        : `Parent cycle: ${[...cycle, cycle[0]].join(" -> ")}`,
    );
  }
  for (const edge of references.selfEdges) {
    crossErrors.push(`'${edge.id}' declares an edge to itself at ${edge.loc}`);
  }
  for (const conflict of references.envelopeConflicts) {
    crossErrors.push(
      `Service '${conflict.service}' names system '${conflict.declared}' but is declared under party '${conflict.envelope}' at ${conflict.loc}`,
    );
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
        for (const finding of checkOperationModelRefs(relFile, key, op.id, op, modelComponents)) {
          warnings.push(finding);
        }
        const missingExchange = eventsExemptFromExchange
          ? (op.kind === "command" || op.kind === "query") && !op.exchange && !isInProcess(op.dispatch)
          : !op.exchange;
        if (missingExchange) {
          warnings.push(`[${relFile}] Operation "${key}" (${op.id ?? "no-id"}) has no exchange block`);
        }
      }
    }

    if (schemaType === "story" && nextSupersedesNextActivities) {
      for (const key of ["processes", "stories"]) {
        const list = data?.[key];
        if (!Array.isArray(list)) continue;
        for (const process of list) {
          if (!Array.isArray(process?.activities)) continue;
          for (const activity of process.activities) {
            const finding = checkDeprecatedNextActivities(relFile, process.id ?? "no-id", activity);
            if (finding) warnings.push(finding);
          }
        }
      }
    }

    if (schemaType === "arch") {
      // Both declaration shapes: a nested service is placed by its party, a root-declared one by
      // its context, and the message names whichever the author wrote.
      for (const declared of archContextsOf(data)) {
        const placement = declared.party
          ? `in party "${declared.party.name}"`
          : `in context "${declared.context.name}"`;
        // Before the service walk: `dependencies` sits on the CONTEXT, not on a service, and a
        // context may declare them while containing no service at all.
        if (couplingSupersedesDependencyType && Array.isArray(declared.context?.dependencies)) {
          for (const dependency of declared.context.dependencies) {
            const finding = checkDeprecatedDependencyType(relFile, declared.context.name, dependency);
            if (finding) warnings.push(finding);
          }
        }
        for (const [service] of servicesOf(declared)) {
          // Before the contracts guard below, which `continue`s: a service binding in-process is
          // exactly the one that may carry no contracts block at all.
          if (handlesRemovedFromSchema) {
            const handlesFinding = checkDeprecatedServiceHandles(relFile, service.name, service);
            if (handlesFinding) warnings.push(handlesFinding);
          }
          if (!service.contracts) {
            warnings.push(`[${relFile}] Service "${service.name}" ${placement} has no contracts block`);
            continue;
          }
          for (const [kind, contract] of Object.entries(service.contracts)) {
            const finding = checkContractOutputSlice(
              relFile, service.name, kind, contract?.output, sliceNames,
            );
            if (finding) warnings.push(finding);
            const sliceFinding = checkContractSlice(
              relFile, service.name, kind, contract?.slice, sliceNames,
            );
            if (sliceFinding) warnings.push(sliceFinding);
            const deprecated = checkDeprecatedContractOutput(relFile, service.name, kind, contract);
            if (deprecated) warnings.push(deprecated);
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

  // The register is checked LAST, so a fault in it can never truncate the model's own findings.
  // It is reported separately from `filesValidated` because it is not one of the model's files:
  // folding it into that count would make the two numbers disagree with the directory they name.
  const trackedRegister =
    args.trackedRegister && fs.existsSync(args.trackedRegister)
      ? checkTrackedRegister({
          registerPath: args.trackedRegister,
          modelDir,
          ajv,
          schemaErrors,
          warnings,
        })
      : null;

  return {
    schemaErrors,
    crossErrors,
    warnings,
    modelPath: modelDir,
    filesValidated,
    filesSkipped: skippedFiles.length,
    skippedFiles,
    trackedRegister,
  };
}
