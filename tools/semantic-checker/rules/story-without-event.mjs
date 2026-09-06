/**
 * A story whose operations include no event.
 *
 * A story's steps are kept on the entity as `data.operationsDetail`, one entry per step with the
 * operation it resolved to - the model builder writes them for both the `operations[]` and the
 * `activities[]` spellings, so this reads one shape for every schema line. The subject is the
 * story; the check follows each resolved id to its operation and asks for its `kind`.
 *
 * An unresolved step is neither an event nor evidence of one: it is counted in the operations
 * and reported under its own kind, `unresolved`, so a story whose only event is a dangling ref is
 * still reported here rather than passing on a reference nothing declares.
 */

/** @param {unknown} entity @returns {Array<Record<string, unknown>>} */
function stepsOf(entity) {
  const data = entity && typeof entity === 'object' ? /** @type {Record<string, unknown>} */ (entity).data : null;
  const steps = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data).operationsDetail : null;
  return Array.isArray(steps) ? steps.filter((step) => step && typeof step === 'object') : [];
}

/**
 * Satisfied when at least one resolved step is an event, or when one of the story's commands
 * `produces` an event - the model has then stated the outcome even though the story did not
 * spell it - or when the story names no operation at all (that is a different gap, and
 * `activity-without-entry-operation` owns it).
 *
 * The `produces` clause is what keeps this rule about ABSENCE rather than about spelling: a story
 * that names "Install Kit Packet" whose command produces "Kit Packet Installed" has an outcome,
 * and reporting it would push authors into restating what the domain layer already says.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function storyWithoutEvent(model, subject) {
  const steps = stepsOf(subject);
  if (steps.length === 0) return { ok: true };
  const kindOf = new Map(
    (model.entities ?? [])
      .filter((entity) => entity.type === 'Operation')
      .map((entity) => [entity.id, String((entity.data ?? {}).kind ?? 'unknown')]),
  );
  // The checker's relation names its ends `source` and `target`; the model builder's names them
  // `source_entity_id` and `target_entity_id`. Reading only the latter made this set empty under
  // `bp check`, so the clause below never fired and every story that names commands and no event
  // was reported - 20 of 38 on a model whose commands all state `produces`. Both spellings are
  // read, so the rule holds whichever model hands it relations.
  const produces = new Set(
    (model.relations ?? [])
      .filter((relation) => relation.type === 'produces')
      .map((relation) => relation.source ?? relation.source_entity_id),
  );
  const kinds = new Map();
  for (const step of steps) {
    const id = typeof step.resolvedEntityId === 'string' ? step.resolvedEntityId : undefined;
    const kind = id && kindOf.has(id) ? kindOf.get(id) : 'unresolved';
    if (kind === 'event') return { ok: true };
    if (id && produces.has(id)) return { ok: true };
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  return {
    ok: false,
    context: {
      operations: String(steps.length),
      kinds: [...kinds].map(([kind, count]) => `${count} ${kind}`),
    },
  };
}
