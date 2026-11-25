// @ts-check
/**
 * Which files form a model, and what to say about the files that do not.
 *
 * A model is the set of files the model builder loads. Every reader of a model (queries, impact
 * analysis, diagrams, viewers) reads what the builder built, so a verdict about any other file would
 * describe content no reader sees, and a file the builder loads but no verdict covers would reach
 * every reader unchecked. Membership is therefore decided by the builder's own routing table,
 * `getSchemaForFile`, through its generated copy beside this module, and by nothing else.
 *
 * A file outside the model takes no part in validation: it is neither schema-checked nor a source of
 * declarations or references. Most such files are ordinary (a README beside the model, a deployment
 * manifest) and are only listed. Three kinds are reported as errors, because each is a model file
 * that would otherwise be lost without a word:
 *
 * - file-not-in-model: a name that looks like a model file and is not one - `<name>-<layer>.yaml`,
 *   `<name>.blueprint.yaml`, `<name>.migrations.yaml`. The message names the spelling that is read.
 * - retired-file-name: a name the builder once loaded and no longer does. The message names the
 *   name that replaced it.
 * - root-document-placement: the root document, `blueprint.yaml`, is read wherever it sits, but a
 *   model has one, at the model root; one below the root or a second one at the root is reported.
 *   These files are still part of the model.
 *
 * Both validators call this module, the standalone one and the model server's, so one model gets
 * one answer about which of its files count.
 */

import { getSchemaForFile, getRetiredFileName, V2_SCHEMA_TYPES } from "./schema-routing.mjs";

/** The kinds of finding this module reports. */
export const FILE_FINDING = Object.freeze({
  notInModel: "file-not-in-model",
  retired: "retired-file-name",
  rootPlacement: "root-document-placement",
});

/** @param {string} relFile */
function fileNameOf(relFile) {
  const segments = relFile.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] ?? "";
}

/** @param {string} relFile @param {string} fileName */
function besideIt(relFile, fileName) {
  const normalized = relFile.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? fileName : `${normalized.slice(0, slash + 1)}${fileName}`;
}

/**
 * The layer a name looks like it holds although the builder does not load it: a bare layer name
 * with an extension the builder does not read in that case, `<name>-<layer>`, or a name ending in a
 * layer the builder reads only at the model root or only bare. Null for every other name. A
 * dot-prefixed name is tool configuration (`.blueprint-quality.yaml`), never a near miss.
 *
 * The layer names are the builder's own, so a layer added there is covered here without an edit.
 *
 * @param {string} fileName
 * @returns {{ layer: string, stem: string, separator: string, extension: string } | null}
 */
export function nearMissLayer(fileName) {
  if (fileName.startsWith(".")) return null;
  const match = /^(.+)\.(yaml|yml)$/i.exec(fileName);
  if (!match) return null;
  const [, base, extension] = /** @type {[string, string, string]} */ (match);
  // Longest first, so `orders-value-stream` is a value stream and not a stream of something else.
  const layers = [...V2_SCHEMA_TYPES].sort((a, b) => b.length - a.length);
  for (const layer of layers) {
    if (base === layer) return { layer, stem: "", separator: "", extension };
    for (const separator of ["-", "."]) {
      if (base.endsWith(`${separator}${layer}`)) {
        return { layer, stem: base.slice(0, -(layer.length + 1)), separator, extension };
      }
    }
  }
  return null;
}

/**
 * What to tell the author of a near-miss file: where its content is read from.
 * @param {string} relFile
 * @param {{ layer: string, stem: string, extension: string }} nearMiss
 */
function nearMissMessage(relFile, { layer, stem, extension }) {
  const lead = `'${relFile}' is not part of the model: no file of this name is read when the model is built.`;
  if (layer === "blueprint") {
    return `${lead} The root document is blueprint.yaml (or .yml) at the model root; move its content there.`;
  }
  if (layer === "migrations") {
    return `${lead} The migration register is migrations.yaml; move its entries there.`;
  }
  const renamed = stem === ""
    ? `${layer}.${extension.toLowerCase()}`
    : `${stem}.${layer}.${extension}`;
  return `${lead} Rename it '${besideIt(relFile, renamed)}'.`;
}

/**
 * @typedef {{ kind: string, file: string, message: string }} FileFinding
 * @typedef {{ modelFiles: string[], outsideFiles: string[], findings: FileFinding[] }} Membership
 */

/**
 * Sort the files of a model directory into the model and the rest, with a finding for every file
 * the author would want to hear about.
 *
 * @param {string[]} relFiles every YAML file in the directory, relative to the model root, `/`-separated
 * @param {{ singleFile?: boolean }} [options] `singleFile`: one file is being validated on its own,
 *   so there is no model root and the placement of a root document is not judged
 * @returns {Membership}
 */
export function classifyModelFiles(relFiles, options = {}) {
  /** @type {string[]} */
  const modelFiles = [];
  /** @type {string[]} */
  const outsideFiles = [];
  /** @type {FileFinding[]} */
  const findings = [];
  /** @type {string[]} */
  const rootDocuments = [];

  for (const relFile of relFiles) {
    const fileName = fileNameOf(relFile);
    // A retired name is checked first, so it gets the message naming its replacement and no other.
    const retired = getRetiredFileName(relFile);
    if (retired) {
      outsideFiles.push(relFile);
      findings.push({
        kind: FILE_FINDING.retired,
        file: relFile,
        message:
          `'${relFile}' is no longer a model file name, so it is not read when the model is built: ` +
          `rename it '${besideIt(relFile, retired.replacementName)}'.`,
      });
      continue;
    }
    const layer = getSchemaForFile(relFile);
    if (layer) {
      modelFiles.push(relFile);
      if (layer === "blueprint") rootDocuments.push(relFile);
      continue;
    }
    outsideFiles.push(relFile);
    const nearMiss = nearMissLayer(fileName);
    if (nearMiss) {
      findings.push({ kind: FILE_FINDING.notInModel, file: relFile, message: nearMissMessage(relFile, nearMiss) });
    }
  }

  if (!options.singleFile) {
    for (const relFile of rootDocuments.filter((file) => file.replace(/\\/g, "/").includes("/"))) {
      findings.push({
        kind: FILE_FINDING.rootPlacement,
        file: relFile,
        message:
          `'${relFile}' is a root document below the model root: a model has one root document, ` +
          `blueprint.yaml (or .yml) at the model root. Move its content there.`,
      });
    }
    const atRoot = rootDocuments.filter((file) => !file.replace(/\\/g, "/").includes("/"));
    if (atRoot.length > 1) {
      findings.push({
        kind: FILE_FINDING.rootPlacement,
        file: atRoot[0] ?? "",
        message:
          `The model root holds ${atRoot.length} root documents (${atRoot.map((file) => `'${file}'`).join(", ")}): ` +
          `a model has one. Keep one and move the others' content into it.`,
      });
    }
  }

  return { modelFiles, outsideFiles, findings };
}
