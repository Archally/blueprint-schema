// @ts-check
/**
 * Cross-reference integrity over a whole model, as structured findings.
 *
 * One implementation, consumed by every validator surface: the standalone validator renders these
 * findings as its "Cross-Reference Errors", and the model server renders the same findings into
 * its validation report, so `bp validate` and MCP `get_validation` cannot disagree about whether
 * a reference resolves. Each surface decides how to word a finding; none decides what one is.
 *
 * Six classes. A MISSING reference names an id nothing declares. A DUPLICATE id is declared
 * twice in the space it is unique in (see `idSpaceOf`), except a party, which is re-declared by
 * design across arch slices and the org layer, and an id a change program's payload describes,
 * which is not a declaration at all. A
 * PARENT CYCLE is a `parent` chain that never terminates - every id in it resolves, so the walk
 * above cannot see it. A SELF EDGE is a relation naming its own declarer - it resolves too, and
 * relates nothing. An ENVELOPE CONFLICT is a service nested under one party whose `system_ref`
 * names another - both resolve, and the two statements of which system the service is a component
 * of contradict each other. A RETIRED BAND is an id spelled with a band the schema line still
 * accepts and no longer wants; it resolves, and it stops resolving one line from now.
 */

import { retiredBandOf, rebanded, outOfBandFinding } from "./id-bands.mjs";
import { indexDeclarations, resolveReference, suggestDeclaredIds } from "./ref-resolve.mjs";
import { detectSchemaType } from "./schema-types.mjs";
import {
  collectIds,
  collectKeyedIds,
  collectParentEdges,
  collectRefs,
  collectSelfEdges,
  collectEnvelopeConflicts,
  findParentCycles,
  isPartyRedeclaration,
} from "./references.mjs";

/**
 * The part of a document that declares ids, for the duplicate check.
 *
 * A change program (`<name>.migration.yaml`) declares one id, its own under `migration:`. Its
 * `changes` block describes entities as they are before and after the change and declares none of
 * them - a split names its source id in `before` and again in `after`, and the entity itself lives in
 * the model - so that block takes no part in duplicate detection. Its ids still resolve a reference,
 * because a program may name the entity its own payload introduces. The type is read from the file
 * name, the one fact every surface passes.
 *
 * @param {string} relFile
 * @param {unknown} data
 */
function declarationsOf(relFile, data) {
  if (detectSchemaType(relFile) !== "migration" || !data || typeof data !== "object" || Array.isArray(data)) return data;
  const { changes: _payload, ...declared } = /** @type {Record<string, unknown>} */ (data);
  return declared;
}

/**
 * @typedef {object} IdSpaces what a schema line says about the space some nested ids are unique in
 * @property {boolean} attributesPerContext a concept attribute (`CAT`) is unique within its bounded
 *   context rather than across the model
 */

/** One space for every id: what a caller that passes no schema line gets. */
const MODEL_WIDE = Object.freeze({ attributesPerContext: false });

/** An unprefixed concept-attribute id. A prefixed one already names its space. */
const BARE_ATTRIBUTE_ID = /^CAT\d{3,}$/;

/**
 * The id spaces a schema line declares, read off the line itself.
 *
 * A line whose `attribute_ref` pattern admits no scope prefix cannot say which bounded context an
 * attribute belongs to, and its text says the attribute takes its context from its parent concept:
 * on that line an attribute id is unique within the context. A line whose pattern admits a prefix
 * resolves an attribute across the model, like any other typed id. A line without `attribute_ref`
 * declares no attribute ids, and the model-wide default holds.
 *
 * @param {Map<string, any>} registry schema documents keyed by path relative to the schema root
 * @returns {IdSpaces}
 */
export function deriveIdSpaces(registry) {
  for (const schema of registry.values()) {
    const pattern = schema?.$defs?.attribute_ref?.pattern;
    if (typeof pattern !== "string") continue;
    return { attributesPerContext: !new RegExp(pattern).test("context.CAT001") };
  }
  return MODEL_WIDE;
}

/** Separates an id from the space it was declared in. A NUL never appears in an id. */
const SPACE = "\u0000";

/** The two containers of activities: a process (2.8) and a story (2.1-2.7), each a root list. */
const ACTIVITY_PARENTS = new Set(["processes", "stories"]);
const INDEX = /^\[\d+\]$/;

/**
 * The space a declaration is unique in, as the key the duplicate pass indexes it by.
 *
 * - A process or story activity is unique within its parent. Every reference the schema admits to
 *   one is written on an activity of the same parent, and every consumer resolves it there, so the
 *   same activity id under two parents names two activities.
 * - A bare concept attribute is unique within its bounded context on a line that says so
 *   (`deriveIdSpaces`); the context is the declaring document's `scope:`, else its folder.
 * - Every other id is unique across the model, compared as declared, so a scope prefix partitions
 *   it and a bare id shares one space with every other bare id.
 *
 * The id itself leads the key, so the finding can name it.
 *
 * @param {IdSpaces} idSpaces
 * @param {string | null} context the declaring document's bounded context
 * @returns {(declared: string, pathStack: string[]) => string}
 */
function idSpaceOf(idSpaces, context) {
  return (declared, pathStack) => {
    const [, parentList, parentIndex, list, index] = pathStack;
    if (pathStack.length === 5 && ACTIVITY_PARENTS.has(parentList) && INDEX.test(parentIndex)
      && list === "activities" && INDEX.test(index)) {
      return `${declared}${SPACE}activity of ${pathStack.slice(0, 3).join(".")}`;
    }
    if (idSpaces.attributesPerContext && BARE_ATTRIBUTE_ID.test(declared)) {
      return `${declared}${SPACE}attribute in context ${context ?? ""}`;
    }
    return declared;
  };
}

/** `RT###` refs point to the resource-type CATALOG in the profiles, never into the model. */
export const CATALOG_REF_RE = /^([a-z][a-z0-9-]*\.)?RT\d{3,}$/;

/**
 * @typedef {object} ModelDocument
 * @property {string} relFile path relative to the model root, POSIX separators
 * @property {unknown} data the parsed YAML
 */

/**
 * @typedef {object} ReferenceFindings
 * @property {Array<{ value: string, loc: string, file: string, suggestions: string[] }>} missing
 *   `suggestions` are the declared ids that differ from `value` only by a prefix (the shared
 *   did-you-mean rule): a hint for the refusal, never a resolution
 * @property {Array<{ id: string, locations: string[] }>} duplicates
 * @property {string[][]} parentCycles each ring in walk order, rotated to its lowest member
 * @property {Array<{ id: string, key: string, arm: string, loc: string, file: string }>} selfEdges
 * @property {Array<{ service: string, declared: string, envelope: string, loc: string, file: string }>} envelopeConflicts
 * @property {Array<{ id: string, band: import("./id-bands.mjs").RetiredBand, rebanded: string, loc: string, file: string }>} retiredBands
 */

/**
 * Resolve every reference the documents make against every id they declare.
 *
 * A reference resolves to the declaration whose id is the same string, across the whole model, by
 * the shared resolution function (`ref-resolve.mjs`, the one the model builder runs). A scope
 * prefix and its dot are part of the id: `CN001` and `orders.CN001` are two ids, so a bare
 * declaration is not also known by its document's scope, and a bare reference is not tried against
 * its own document's scope. A reference is MISSING exactly when the function answers `unresolved`;
 * a string declared more than once answers `ambiguous`, which the duplicate pass reports on its
 * own. The `scope:key` form is declared by the map entries of a scoped document, its scope being
 * the declared one or else the folder, and resolves by that composed string.
 *
 * A retired band is reported on the DECLARATION, once per id. A reference to a retired-band id
 * either resolves - to a declaration this pass already names, so repeating it per mention would
 * report one thing hundreds of times - or it does not, and is already a missing reference. The
 * declaration is therefore the complete set, and it is also the thing an author edits.
 *
 * @param {ModelDocument[]} documents every readable document, whether or not a schema knows it
 * @param {import("./reference-keys.mjs").ReferenceKeys} refKeys
 * @param {import("./id-bands.mjs").RetiredBandTable} [bandTable] what this schema line retires;
 *   omitted, nothing is retired, which is the right answer for a line that retires nothing
 * @param {Array<unknown>} [declaredBands] the bands the model itself declares
 * @param {IdSpaces} [idSpaces] the id spaces the schema line declares (`deriveIdSpaces`);
 *   omitted, every id outside an activity is unique across the model
 * @returns {ReferenceFindings}
 */
const DOMAIN_ID_RE = /^DMN\d{3,}$/;
const SUBDOMAIN_ID_RE = /^SDM\d{3,}$/;

/**
 * Every `domain_ref` a context declares, paired with the vocabulary the model declares for it.
 *
 * A `domain_ref` resolves three ways, and each has its own way of being wrong: a `DMN###` naming no
 * registry entry, an `SDM###` naming no nested subdomain, or a bare name outside the declared
 * vocabulary. All three are references that resolve to nothing, which is what cross-reference
 * validation means, so all three are errors here rather than advisories.
 *
 * The declared vocabulary is the `domains[]` registry when the model has one, and the model's own
 * source folders otherwise - the same two partitions the domain resolver reads, in the same order.
 *
 * @param {ModelDocument[]} documents
 * @returns {Array<{ context: string, ref: string, loc: string, file: string }>}
 */
function unresolvedDomainRefs(documents) {
  const domainIds = new Set();
  const subdomainIds = new Set();
  const names = new Set();
  const folders = new Set();

  for (const { relFile, data } of documents) {
    if (!data || typeof data !== "object") continue;
    if (relFile.includes("/")) folders.add(relFile.slice(0, relFile.indexOf("/")).toLowerCase());
    const registry = /** @type {Record<string, unknown>} */ (data).domains;
    if (!Array.isArray(registry)) continue;
    for (const domain of registry) {
      if (!domain || typeof domain !== "object") continue;
      const entry = /** @type {Record<string, unknown>} */ (domain);
      if (typeof entry.id === "string") domainIds.add(entry.id);
      if (typeof entry.name === "string") names.add(entry.name.toLowerCase());
      if (!Array.isArray(entry.subdomains)) continue;
      for (const subdomain of entry.subdomains) {
        if (subdomain && typeof subdomain === "object") {
          const nested = /** @type {Record<string, unknown>} */ (subdomain);
          if (typeof nested.id === "string") subdomainIds.add(nested.id);
        }
      }
    }
  }
  // A model with no registry falls back to its folders, which is the resolver's own second tier.
  const vocabulary = names.size > 0 ? names : folders;

  const findings = [];
  const visit = (node, path, relFile) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...path, String(index)], relFile));
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (node);
    const ref = record.domain_ref;
    if (typeof ref === "string" && ref) {
      const resolved = DOMAIN_ID_RE.test(ref)
        ? domainIds.has(ref)
        : SUBDOMAIN_ID_RE.test(ref)
          ? subdomainIds.has(ref)
          : vocabulary.has(ref.toLowerCase());
      if (!resolved) {
        const context = typeof record.name === "string" ? record.name : typeof record.id === "string" ? record.id : "(unnamed)";
        findings.push({ context, ref, loc: [relFile, ...path].join("."), file: relFile });
      }
    }
    for (const [key, value] of Object.entries(record)) visit(value, [...path, key], relFile);
  };
  for (const { relFile, data } of documents) visit(data, [], relFile);
  return findings;
}

export function resolveModelReferences(documents, refKeys, bandTable, declaredBands = [], idSpaces = MODEL_WIDE) {
  // Every declaration, as the shared resolution function indexes it: the id exactly as written and
  // the location it was declared at.
  const declarations = [];
  const allDuplicates = new Map();
  // Duplicate detection runs over the whole model in one pass below, keyed by the space each id is
  // unique in; resolution needs only the id strings.
  const everything = new Map();
  const parentEdges = new Map();
  const selfEdges = [];
  const envelopeConflicts = [];
  const allRefs = [];
  const retiredBands = new Map();
  // Ownership, beside retirement: the same walk already knows each id and the folder it came from,
  // and the folder IS the slice a band is declared on. Collecting here rather than re-walking the
  // model keeps one traversal answering both id-band questions.
  const outOfBand = new Map();

  for (const { relFile, data } of documents) {
    if (!data || typeof data !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (data);
    const declaredScope = typeof record.scope === "string" ? record.scope : null;
    // The folder is the slice an id-band declaration names, and the fallback scope of the keyed
    // `scope:key` form; neither resolves a typed id.
    const folderScope = relFile.includes("/") ? relFile.slice(0, relFile.indexOf("/")) : null;

    const declaredHere = new Map();
    collectIds(data, declaredHere, new Map(), [relFile]);
    for (const [id, loc] of declaredHere) declarations.push({ id, handle: loc });
    for (const [id, loc] of declaredHere) {
      if (retiredBands.has(id)) continue;
      const band = retiredBandOf(id, bandTable);
      if (band) retiredBands.set(id, { id, band, rebanded: rebanded(id, band), loc, file: relFile });
    }
    if (declaredBands.length > 0 && folderScope) {
      for (const [id] of declaredHere) {
        // One finding per id, however many files declare it - the second declaration is a duplicate,
        // which is a different report with its own message.
        if (outOfBand.has(id)) continue;
        const finding = outOfBandFinding(id, folderScope, declaredBands);
        if (finding) outOfBand.set(id, { ...finding, file: relFile });
      }
    }
    for (const [keyed, loc] of collectKeyedIds(data, declaredScope ?? folderScope, new Map(), [relFile])) {
      declarations.push({ id: keyed, handle: loc });
    }
    collectParentEdges(data, parentEdges);
    collectSelfEdges(data, selfEdges, null, [relFile]);
    for (const conflict of collectEnvelopeConflicts(data, [], [relFile])) {
      envelopeConflicts.push({ ...conflict, file: relFile });
    }
    for (const ref of collectRefs(data, [], [relFile], refKeys)) {
      allRefs.push({ ...ref, file: relFile });
    }
  }

  for (const { relFile, data } of documents) {
    if (!data || typeof data !== "object") continue;
    const declaredScope = /** @type {Record<string, unknown>} */ (data).scope;
    const context = typeof declaredScope === "string"
      ? declaredScope
      : relFile.includes("/") ? relFile.slice(0, relFile.indexOf("/")) : null;
    collectIds(declarationsOf(relFile, data), everything, allDuplicates, [relFile], idSpaceOf(idSpaces, context));
  }

  const index = indexDeclarations(declarations);
  const missing = [];
  for (const ref of allRefs) {
    if (CATALOG_REF_RE.test(ref.value)) continue;
    if (resolveReference(index, ref.value).status !== "unresolved") continue;
    missing.push({ value: ref.value, loc: ref.loc, file: ref.file, suggestions: suggestDeclaredIds(index.byId.keys(), ref.value) });
  }

  const duplicates = [];
  for (const [space, locations] of allDuplicates.entries()) {
    if (isPartyRedeclaration(locations)) continue;
    duplicates.push({ id: space.split(SPACE)[0], locations });
  }

  return {
    missing,
    duplicates,
    parentCycles: findParentCycles(parentEdges),
    selfEdges: selfEdges.map((edge) => ({ ...edge, file: edge.loc.split(".")[0] })),
    envelopeConflicts,
    retiredBands: [...retiredBands.values()],
    outOfBand: [...outOfBand.values()],
    unresolvedDomainRefs: unresolvedDomainRefs(documents),
  };
}
