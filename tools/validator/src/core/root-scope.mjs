// @ts-check
/**
 * A file at the model root whose `scope:` names no slice of the model.
 *
 * A file's `scope:` says which slice (bounded context) the file belongs to. A slice is a top-level
 * directory of the model, and the validator already reads a file's slice from its first path
 * segment, so a file nested in a slice has a slice whether or not it says so. A file at the model
 * root belongs to no slice: a `scope:` there that names one of the model's slices is a statement the
 * reader can check, and one that names none is a namespace with no slice behind it. Ids keyed by
 * `scope:key` are declared under that name, so the value is not inert.
 *
 * A warning, never an error: the schema accepts the key on every layer file and requires it on
 * none, so the finding changes no accepted document. A decision about a cross-cutting area or the
 * whole system says so with its own `decision_scope`, which is a named scope rather than a slice.
 *
 * Both validators call this module, the standalone one and the model server's, so one model gets
 * one set of findings in one wording.
 */

/** The prefix every finding's message starts with, so a reader can select this class of warning. */
export const ROOT_SCOPE_PREFIX = "Root-level scope:";

/**
 * The slices a model has: the first path segment of every file below the model root.
 *
 * @param {Array<{ relFile: string }>} documents
 * @returns {Set<string>}
 */
export function modelSlices(documents) {
  const slices = new Set();
  for (const { relFile } of documents) {
    const posix = relFile.replace(/\\/g, "/");
    const slash = posix.indexOf("/");
    if (slash > 0) slices.add(posix.slice(0, slash));
  }
  return slices;
}

/**
 * One finding per document at the model root whose `scope:` is a string naming none of the model's
 * slices. A nested document, a root document with no `scope:`, and a root `scope:` that names a
 * slice yield none.
 *
 * @param {Array<{ relFile: string, data: unknown }>} documents the parsed model files, paths relative to the model root
 * @returns {Array<{ file: string, scope: string, holdsDecisions: boolean }>}
 */
export function rootScopeFindings(documents) {
  const slices = modelSlices(documents);
  const findings = [];
  for (const { relFile, data } of documents) {
    if (relFile.replace(/\\/g, "/").includes("/")) continue;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const record = /** @type {Record<string, unknown>} */ (data);
    if (typeof record.scope !== "string") continue;
    if (slices.has(record.scope)) continue;
    findings.push({ file: relFile, scope: record.scope, holdsDecisions: Array.isArray(record.decisions) });
  }
  return findings;
}

/**
 * The sentence every surface prints for one finding.
 *
 * @param {{ file: string, scope: string, holdsDecisions: boolean }} finding
 * @returns {string}
 */
export function rootScopeMessage(finding) {
  const decisions = finding.holdsDecisions
    ? " A decision states the scope it applies to with its own `decision_scope`."
    : "";
  return (
    `${ROOT_SCOPE_PREFIX} [${finding.file}] declares scope '${finding.scope}', which names no slice of ` +
    `this model. A file at the model root belongs to no slice: remove \`scope:\`.${decisions}`
  );
}
