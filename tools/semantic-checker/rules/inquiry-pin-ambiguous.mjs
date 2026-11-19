import { KIND_LISTS } from './inquiry-pin-named-twice.mjs';

/**
 * An inquiry whose `affects.element_refs` names an id several elements declare. It reads the
 * placeholder the model builder draws for the pin, so the rule and the graph resolve one id one
 * way, and skips an id a kind list also names, which is that list's pin.
 */

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item !== '') : [];
}

/** @param {any} subject */
function affectsOf(subject) {
  if (subject?.type !== 'Inquiry') return null;
  return asRecord(asRecord(subject.data)?.affects);
}

/** @param {any} subject @returns {Set<string>} */
function ownIds(subject) {
  const ids = new Set();
  if (typeof subject?.displayId === 'string') ids.add(subject.displayId);
  const declared = asRecord(subject?.data)?.id;
  if (typeof declared === 'string') ids.add(declared);
  return ids;
}

/** @param {any} model @param {any} subject */
export const inquiryPinAmbiguous = (model, subject) => {
  const affects = affectsOf(subject);
  if (!affects) return { ok: true };
  const inKindLists = new Set(KIND_LISTS.flatMap((list) => strings(affects[list])));
  const own = ownIds(subject);
  const pinned = strings(affects.element_refs).filter((id) => !inKindLists.has(id) && !own.has(id));
  if (pinned.length === 0) return { ok: true };
  const entities = Array.isArray(model?.entities) ? model.entities : [];
  const relations = Array.isArray(model?.relations) ? model.relations : [];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const displayOf = (/** @type {string} */ id) => byId.get(id)?.displayId ?? id;
  const ambiguous = [];
  const candidates = new Set();
  for (const id of pinned) {
    const placeholder = relations
      .filter((relation) => relation.source === subject.id && relation.type === 'inquiry_affects')
      .map((relation) => byId.get(relation.target))
      .find((target) => target?.type === 'Missing' && target.displayId === id && asRecord(target.data)?.ambiguous === true);
    if (!placeholder) continue;
    ambiguous.push(id);
    for (const candidate of strings(asRecord(placeholder.data)?.candidates)) candidates.add(displayOf(candidate));
  }
  if (ambiguous.length === 0) return { ok: true };
  return { ok: false, context: { ids: ambiguous.join(', '), candidates: [...candidates].join(', ') } };
};
