// @ts-check
import { entriesOf } from './collect.mjs';

const discoveryStages = new Set(['hypothesis', 'exploring', 'validated', 'committed', 'obsolete']);
const certainties = new Set(['speculative', 'probable', 'confirmed']);

/** Coverage means a stated fact about provenance, not a claim that the activity is verified.
 * @param {any} provenance
 */
export function hasStatedProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return false;
  }
  return discoveryStages.has(provenance.discovery_stage) || certainties.has(provenance.certainty)
    || (Array.isArray(provenance.evidence) && provenance.evidence.some((evidence) =>
      evidence && typeof evidence === 'object'
      && typeof evidence.summary === 'string' && evidence.summary.trim().length > 0));
}

/** Report-only: this count never enters scoring, findings, thresholds or baselines.
 * @param {Array<{file: string, doc: any, slice?: string}>} documents
 * @param {{slice?: string, changedFiles?: Set<string>, selection?: {selected: Set<any>}}} [scope]
 */
export function measureWorkProcessProvenance(documents, scope = {}) {
  const defaults = new Map();
  for (const document of documents) {
    for (const slice of document.doc?.layout?.slices ?? []) {
      if (!slice || typeof slice !== 'object' || typeof slice.name !== 'string') {
        continue;
      }
      if (slice.describes !== 'organization' && slice.describes !== 'system') {
        continue;
      }
      const values = defaults.get(slice.name) ?? new Set();
      values.add(slice.describes);
      defaults.set(slice.name, values);
    }
  }
  let total = 0;
  let covered = 0;
  for (const document of documents) {
    if (scope.slice && document.slice !== scope.slice) {
      continue;
    }
    if (scope.changedFiles && !scope.changedFiles.has(document.file)) {
      continue;
    }
    const values = defaults.get(document.slice);
    const inherited = values?.size === 1 ? [...values][0] : undefined;
    for (const [, process] of entriesOf(document.doc?.processes)) {
      if ((process.describes ?? inherited ?? 'system') !== 'organization') {
        continue;
      }
      if (scope.selection && ![...scope.selection.selected].some((observation) =>
        observation.file === document.file && observation.entityId === process.id)) {
        continue;
      }
      for (const [, activity] of entriesOf(process.activities)) {
        total++;
        if (hasStatedProvenance(activity.provenance)) {
          covered++;
        }
      }
    }
  }
  return { covered, total };
}
