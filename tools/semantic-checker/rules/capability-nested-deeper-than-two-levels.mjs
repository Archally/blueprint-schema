/** Deeper declarations are reported independently of their realization. */
import { capabilityIndex, declaredId, nameOf } from './capability-hierarchy.mjs';

/**
 * @param {any} model
 * @param {any} subject
 */
export const capabilityNestedDeeperThanTwoLevels = (model, subject) => {
  const index = capabilityIndex(model);
  const nesting = index.deeper.get(subject.id);
  if (!nesting) return { ok: true };
  const parent = index.byId.get(nesting.parent);
  const root = index.byId.get(nesting.root);
  return {
    ok: false,
    context: {
      capability: declaredId(subject), capability_name: nameOf(subject),
      parent: declaredId(parent), parent_name: nameOf(parent),
      root: declaredId(root), root_name: nameOf(root),
    },
  };
};
