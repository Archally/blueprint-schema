/**
 * An operation realized by two or more capabilities, at least two of which are not one another's
 * direct L1 parent or L2 child.
 *
 * A capability realizes an operation where the model graph draws a `capability_operation` edge
 * between them: the capability lists the operation under `operations` (origin `operation`), or no
 * capability lists it and the capability's `realized_in` names its domain or a bounded context that
 * handles it (origin `module`). A pair of capabilities where one is the direct L1 parent of the other in the
 * `children` hierarchy is a refinement, not a disagreement, and is ignored; an operation is
 * reported when ANY pair of its capabilities is unrelated, even if other pairs are related.
 *
 * INFO, not a defect: an operation may serve two capabilities on purpose. The finding makes the
 * overlap countable, so a reader can confirm it or attribute the operation to one capability.
 */
import { ancestorsOf, byCodeUnit, capabilityIndex, declaredId, nameOf } from './capability-hierarchy.mjs';

const SHOWN_CAPABILITIES = 8;

/**
 * @param {any} model
 * @param {any} subject
 */
export const operationRealizesTwoCapabilities = (model, subject) => {
  const index = capabilityIndex(model);
  const realizing = index.capabilitiesByOperation.get(subject.id);
  if (!realizing || realizing.size < 2) return { ok: true };

  const ids = [...realizing.keys()];
  const ancestors = new Map(ids.map((id) => [id, ancestorsOf(index, id)]));
  const unrelated = ids.some((first, i) =>
    ids.slice(i + 1).some((second) => !ancestors.get(first)?.has(second) && !ancestors.get(second)?.has(first)),
  );
  if (!unrelated) return { ok: true };

  const capabilities = ids
    .map((id) => ({ id, entity: index.byId.get(id), origin: realizing.get(id) }))
    .sort((a, b) => byCodeUnit(declaredId(a.entity), declaredId(b.entity)) || byCodeUnit(a.id, b.id));
  const shown = capabilities
    .slice(0, SHOWN_CAPABILITIES)
    .map((capability) => `${declaredId(capability.entity)} "${nameOf(capability.entity)}" (${capability.origin})`);
  const rest = capabilities.length - shown.length;
  return {
    ok: false,
    context: {
      operation: subject.displayId ?? declaredId(subject),
      operation_name: nameOf(subject),
      count: String(capabilities.length),
      capabilities: shown.join(', ') + (rest > 0 ? ` and ${rest} more` : ''),
    },
  };
};
