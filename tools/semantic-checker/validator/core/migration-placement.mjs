// @ts-check
import { modelSlices } from "./root-scope.mjs";
import { detectSchemaType } from "./schema-types.mjs";

/**
 * Where a migration document says an entity lands, checked against the model.
 *
 * An entity change of kind add, split, merge or move may state `placement` (a slice, a file, or
 * both); a move may also state `placement_before`. The schema checks their shape. This checks what
 * the shape cannot: that a file and a slice stated together agree, that a file's name routes to a
 * layer, that the layer holds the entity's type, that the slice is one the model has, and that the
 * internal `after._written_in` key, which a migration may still carry, agrees with `placement`. A
 * meta operation `move-to-slice` or `document-move` whose target is an entity id moves nothing when
 * the migration applies, and is reported so that a reader does not take it for a move.
 */

/** The file layers each migration entity type is declared in; a type absent here is not checked. */
const LAYERS_OF_ENTITY_TYPE = {
  concept: ["concepts"], actor: ["concepts"], enumeration: ["concepts"], association: ["concepts"],
  operation: ["domain"], error: ["domain"], question: ["domain"],
  rule: ["rules"], transition: ["rules"],
  model: ["models"],
  process: ["story"], "process-activity": ["story"], "user-story": ["story"], "use-case": ["story"],
  party: ["org", "organization", "arch"], department: ["org", "organization"], team: ["org", "organization"],
  context: ["arch"], service: ["arch"], contract: ["arch"], dependency: ["arch"],
  goal: ["motivation"], "non-goal": ["motivation"], risk: ["motivation"], assumption: ["motivation"],
  "trade-off": ["motivation"], inquiry: ["motivation"],
  decision: ["decisions"],
  capability: ["capability"],
  "test-case": ["test-cases"], "fitness-function": ["test-cases"],
  metric: ["quality"], kpi: ["quality"], slo: ["quality"], sla: ["quality"], security: ["quality"],
  compliance: ["quality"], resilience: ["quality"],
  parallelism: ["dynamics"], ordering: ["dynamics"], "race-condition": ["dynamics"],
  screen: ["ui", "interactions"], "ui-action": ["ui", "interactions"], "ui-navigation": ["ui", "interactions"],
  resource: ["infrastructure", "rg"],
  milestone: ["roadmap"],
  "value-stream": ["value-stream"],
};

const PLACED_KINDS = new Set(["add", "split", "merge", "move"]);
const META_MOVES = new Set(["move-to-slice", "document-move"]);

/** @param {unknown} value */
function placementOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = /** @type {Record<string, unknown>} */ (value);
  const slice = typeof record.slice === "string" && record.slice.length > 0 ? record.slice : undefined;
  const file = typeof record.file === "string" && record.file.length > 0 ? record.file.replace(/\\/g, "/") : undefined;
  return slice || file ? { slice, file } : undefined;
}

/** @param {string} path */
function sliceFolderOf(path) {
  const slash = path.indexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}

/**
 * The slices a model has: its folders below the model root, other than a dot folder, and the
 * `layout.slices` its blueprint.yaml lists.
 *
 * @param {Array<{ relFile: string, data: any }>} documents
 */
function declaredSlices(documents) {
  const slices = new Set([...modelSlices(documents)].filter((name) => !name.startsWith(".")));
  for (const { relFile, data } of documents) {
    if (detectSchemaType(relFile) !== "blueprint") continue;
    const listed = data?.layout?.slices ?? data?.slices;
    if (!Array.isArray(listed)) continue;
    for (const item of listed) {
      if (typeof item === "string") slices.add(item);
      else if (typeof item?.name === "string") slices.add(item.name);
    }
  }
  return slices;
}

/** The `after` blocks of a change that hold an entity with a declared place, `_written_in` included. */
function afterBlocksOf(change) {
  if (change.kind === "split") return Array.isArray(change.after) ? change.after.filter((item) => item && typeof item === "object") : [];
  return change.after && typeof change.after === "object" && !Array.isArray(change.after) ? [change.after] : [];
}

/**
 * @param {Array<{ relFile: string, data: any }>} documents
 * @param {(id: string) => boolean} isDeclared whether the model declares an entity with this id
 * @returns {{ errors: Array<{ file: string, message: string }>, warnings: Array<{ file: string, message: string }> }}
 */
export function migrationPlacementFindings(documents, isDeclared) {
  const errors = [];
  const warnings = [];
  const slices = declaredSlices(documents);
  for (const { relFile, data } of documents) {
    if (detectSchemaType(relFile) !== "migration") continue;
    const changes = data?.changes?.entities;
    if (Array.isArray(changes)) {
      changes.forEach((change, index) => {
        if (!change || typeof change !== "object") return;
        const at = `[${relFile}] changes.entities[${index}] (${change.kind} ${change.target})`;
        for (const key of ["placement", "placement_before"]) {
          const placement = placementOf(change[key]);
          if (!placement) continue;
          if (placement.slice && placement.file && sliceFolderOf(placement.file) !== placement.slice) {
            errors.push({ file: relFile, message: `${at} ${key} names slice '${placement.slice}' and file '${placement.file}', which is not in that slice` });
          }
          if (placement.file) {
            const layer = detectSchemaType(placement.file);
            const layers = LAYERS_OF_ENTITY_TYPE[change.entity_type];
            if (!layer || layer === "migration" || layer === "migrations" || layer === "blueprint") {
              errors.push({ file: relFile, message: `${at} ${key} names file '${placement.file}', whose name routes to no layer of the model` });
            } else if (layers && !layers.includes(layer)) {
              warnings.push({ file: relFile, message: `${at} ${key} names file '${placement.file}', a ${layer} file, which does not hold a ${change.entity_type}` });
            }
          }
          const slice = placement.slice ?? (placement.file ? sliceFolderOf(placement.file) : "");
          if (slice && !slices.has(slice)) {
            warnings.push({ file: relFile, message: `${at} ${key} names slice '${slice}', which the model has neither as a folder nor in blueprint.yaml layout.slices` });
          }
        }
        if (!PLACED_KINDS.has(change.kind)) return;
        const placement = placementOf(change.placement);
        for (const after of afterBlocksOf(change)) {
          const written = typeof after._written_in === "string" ? after._written_in.replace(/\\/g, "/") : undefined;
          if (!written) continue;
          if (!placement) {
            warnings.push({ file: relFile, message: `${at} states its destination as after._written_in '${written}'; state it as placement: { file: '${written}' }` });
          } else if ((placement.file && placement.file !== written) || (!placement.file && placement.slice && sliceFolderOf(written) !== placement.slice)) {
            errors.push({ file: relFile, message: `${at} after._written_in '${written}' disagrees with its placement` });
          }
        }
      });
    }
    const meta = data?.changes?.meta;
    if (Array.isArray(meta)) {
      meta.forEach((change, index) => {
        if (!META_MOVES.has(change?.kind) || typeof change.target !== "string") return;
        if (!isDeclared(change.target)) return;
        warnings.push({
          file: relFile,
          message: `[${relFile}] changes.meta[${index}] ${change.kind} targets entity '${change.target}', which applying the migration does not move; an entity is moved by an entity change of kind move`,
        });
      });
    }
  }
  return { errors, warnings };
}
