import { capabilityIndex, declaredId, nameOf } from './capability-hierarchy.mjs';

/** The event is expected at its producer's capability, or their nearest shared parent. */
export const eventPlacedWithProducerCapability = (model, subject) => {
  if (subject.data?.kind !== 'event') return { ok: true };
  const index = capabilityIndex(model);
  const producers = new Set((model.relations ?? [])
    .filter((relation) => relation.type === 'produces' && relation.target === subject.id)
    .map((relation) => relation.source));
  const producerCapabilities = new Set();
  for (const producer of producers) {
    for (const capability of index.capabilitiesByOperation.get(producer)?.keys() ?? []) producerCapabilities.add(capability);
  }
  if (producerCapabilities.size === 0) return { ok: true };
  const placed = index.capabilitiesByOperation.get(subject.id);
  if (!placed?.size) return { ok: true };

  const lineage = (id) => new Set([id, ...(index.parents.get(id) ?? [])]);
  const lineages = [...producerCapabilities].map(lineage);
  const common = [...lineages[0]].filter((candidate) => lineages.every((path) => path.has(candidate)));
  if (common.length === 0) return { ok: true };
  const expected = common.find((candidate) => !common.some((other) => other !== candidate && index.parents.get(other)?.has(candidate)));
  if (!expected || placed.has(expected)) return { ok: true };
  const expectedEntity = index.byId.get(expected);
  return {
    ok: false,
    context: {
      event: subject.displayId ?? declaredId(subject),
      event_name: nameOf(subject),
      expected: `${declaredId(expectedEntity)} "${nameOf(expectedEntity)}"`,
    },
  };
};
