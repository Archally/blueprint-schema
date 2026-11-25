// @ts-check
/**
 * The two shapes an arch document declares its bounded contexts in, walked once.
 *
 * A context is declared either NESTED under the party whose services it carries (`parties[].contexts[]`)
 * or WHOLE at the document root (`contexts[]`), and one document may use both. Every consumer that
 * walks contexts reads them through this function, so the second shape cannot be missed by one walk
 * and read by another: a walk that reads only `parties` reports a root-declared context as absent,
 * which reads exactly like a model that declares none.
 *
 * `path` is the location stack in the spelling `collectIds` and `collectRefs` use (`parties`, `[0]`,
 * `contexts`, `[1]`), so a finding built from it lands beside the reference walk's.
 */

/**
 * @typedef {object} DeclaredContext
 * @property {Record<string, unknown> | null} party the enclosing party in the nested form, null at the root
 * @property {Record<string, unknown>} context
 * @property {string[]} path location stack of the context, relative to the document
 */

/**
 * @param {unknown} data a parsed arch document
 * @returns {DeclaredContext[]} nested contexts first, in declaration order, then the root ones
 */
export function archContextsOf(data) {
  /** @type {DeclaredContext[]} */
  const found = [];
  if (!data || typeof data !== "object") return found;
  const record = /** @type {Record<string, unknown>} */ (data);
  if (Array.isArray(record.parties)) {
    record.parties.forEach((party, partyIndex) => {
      if (!party || typeof party !== "object") return;
      const contexts = /** @type {Record<string, unknown>} */ (party).contexts;
      if (!Array.isArray(contexts)) return;
      contexts.forEach((context, contextIndex) => {
        if (!context || typeof context !== "object") return;
        found.push({
          party: /** @type {Record<string, unknown>} */ (party),
          context: /** @type {Record<string, unknown>} */ (context),
          path: ["parties", `[${partyIndex}]`, "contexts", `[${contextIndex}]`],
        });
      });
    });
  }
  if (Array.isArray(record.contexts)) {
    record.contexts.forEach((context, contextIndex) => {
      if (!context || typeof context !== "object") return;
      found.push({
        party: null,
        context: /** @type {Record<string, unknown>} */ (context),
        path: ["contexts", `[${contextIndex}]`],
      });
    });
  }
  return found;
}

/** The services a declared context carries, as `[service, path]` pairs. */
export function servicesOf(declared) {
  const services = declared.context.services;
  if (!Array.isArray(services)) return [];
  return services
    .map((service, index) => /** @type {const} */ ([service, [...declared.path, "services", `[${index}]`]]))
    .filter(([service]) => service && typeof service === "object");
}
