// @ts-check
/**
 * Spec + project-override loading.
 *
 * The spec ships with the tool and is the shared definition of what "good" means.
 * The project override (`.blueprint-quality.yaml`) is where a specific model states
 * its own bar, its ratchet, and its reasoned deferrals. Nothing here resolves paths
 * relative to the tool's own location beyond the default spec, so the same files
 * work from either repo (plan D18 — the port is a copy).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SPEC_PATH = path.join(TOOL_DIR, 'quality-spec.yaml');
export const PROJECT_CONFIG_NAME = '.blueprint-quality.yaml';

/** @param {string} file */
function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
}

/**
 * @param {string} [specPath]
 * @returns {{spec: object, path: string}}
 */
export function loadSpec(specPath) {
  const resolved = specPath ? path.resolve(specPath) : DEFAULT_SPEC_PATH;
  if (!fs.existsSync(resolved)) throw new Error(`quality spec not found: ${resolved}`);
  const spec = readYaml(resolved);
  if (!spec.metrics || typeof spec.metrics !== 'object') {
    throw new Error(`quality spec has no "metrics" block: ${resolved}`);
  }
  return { spec, path: resolved };
}

/**
 * Look for a project override in the model root, then walk up to the project dir —
 * `.blueprint/v2.7/` models conventionally keep theirs beside `.blueprint/`.
 * @param {string} modelRoot
 * @param {string} [explicitPath]
 * @returns {{config: object, path: string|null}}
 */
export function loadProjectConfig(modelRoot, explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) throw new Error(`project config not found: ${resolved}`);
    return { config: readYaml(resolved), path: resolved };
  }
  let directory = path.resolve(modelRoot);
  for (let depth = 0; depth < 4; depth++) {
    const candidate = path.join(directory, PROJECT_CONFIG_NAME);
    if (fs.existsSync(candidate)) return { config: readYaml(candidate), path: candidate };
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { config: {}, path: null };
}

/**
 * Persist an updated baseline, preserving everything else in the file (including
 * comments where the file already existed).
 *
 * A whole-model update writes the flat `baseline.<metric>` entries and leaves any
 * per-slice `baseline.slices` untouched; a slice update writes only
 * `baseline.slices.<slice>.<metric>` and leaves the flat entries and its sibling
 * slices untouched. The two ratchets are independent claims and must not clobber
 * each other.
 * @param {string} configPath
 * @param {Record<string, number>} baseline metric → score for the run being ratcheted
 * @param {string} [slice] when given, write under `baseline.slices.<slice>` instead
 */
export function writeBaseline(configPath, baseline, slice) {
  const document = fs.existsSync(configPath)
    ? YAML.parseDocument(fs.readFileSync(configPath, 'utf8'))
    : YAML.parseDocument('# Blueprint quality-gate project configuration\n');

  // Read the existing baseline as a plain JS value so flat entries and the per-slice
  // block can be recombined and written back as a single node — setting the node and
  // then reaching back into it with setIn fights the YAML document model.
  const existing = document.get('baseline');
  const existingObject = existing && typeof existing.toJSON === 'function' ? existing.toJSON() : (existing ?? {});
  const { slices: existingSlices, ...existingFlat } = existingObject;

  let nextBaselineBlock;
  if (slice) {
    nextBaselineBlock = { ...existingFlat, slices: { ...(existingSlices ?? {}), [slice]: baseline } };
  } else {
    nextBaselineBlock = { ...baseline };
    if (existingSlices !== undefined) nextBaselineBlock.slices = existingSlices;
  }

  document.set('baseline', nextBaselineBlock);
  fs.writeFileSync(configPath, String(document));
}
