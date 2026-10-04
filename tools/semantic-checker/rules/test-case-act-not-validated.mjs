/**
 * A test case's `when.operation` names the operation its act invokes, and the model graph draws it as
 * a `test_case_act` edge. That edge is deliberately not coverage: an operation counts as tested only
 * when a test case lists it under `validates.operations`. So a case whose act calls an operation it
 * does not also list under `validates.operations` exercises that operation while every coverage
 * table reports it untested by the case. This module reports that case, and the rule's hint names
 * both fixes: list the operation under `validates.operations`, or correct the act.
 *
 * THE COMPARISON IS BY RESOLVED ENTITY, NOT BY STRING. An operation reference has two forms, a typed
 * id (`orders.CMD001`) and `domain:key` (`orders:placeOrder`), and a case may write the act in one
 * and `validates` in the other. Both edges resolve to the same operation entity, so the module
 * compares the targets of the two edges, which is why this is a custom check rather than a field
 * comparison in the rule language.
 *
 * ONLY A DIRECT ENTRY COUNTS. An operation reached through the steps of a use case or a process the
 * case validates is still reported, because coverage counts `validates.operations` alone: that
 * operation reads as untested by this case on every coverage table, and adding it to
 * `validates.operations` is what changes the table.
 *
 * SILENT WHERE ANOTHER CHECK OWNS THE FINDING. A case with no `when.operation` says nothing about an
 * operation. An act naming an operation the model does not declare is a cross-reference error that
 * validation already reports, so it is not reported a second time here.
 */

const ACT = 'test_case_act';
/** The engine's name for `validates`, and the builder's own name, so either adapter's model works. */
const VALIDATES = new Set(['validated-by', 'validates']);
const OPERATION_PREDICATE = 'operation';
const PLACEHOLDER = 'Missing';

/** @type {WeakMap<object, { byId: Map<string, any>, actOf: Map<string, string>, validatedOperations: Map<string, Set<string>> }>} */
const cache = new WeakMap();

/** @param {any} relation */
const sourceOf = (relation) => relation?.source ?? relation?.source_entity_id;
/** @param {any} relation */
const targetOf = (relation) => relation?.target ?? relation?.target_entity_id;

/** @param {any} model */
function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const entity of model.entities ?? []) byId.set(entity.id, entity);

  /** @type {Map<string, string>} test case id -> the operation its act invokes. */
  const actOf = new Map();
  /** @type {Map<string, Set<string>>} test case id -> the operations it lists under validates. */
  const validatedOperations = new Map();
  for (const relation of model.relations ?? []) {
    const source = sourceOf(relation);
    const target = targetOf(relation);
    if (typeof source !== 'string' || typeof target !== 'string') continue;
    if (relation.type === ACT) {
      actOf.set(source, target);
    } else if (VALIDATES.has(relation.type) && relation.predicate === OPERATION_PREDICATE) {
      let operations = validatedOperations.get(source);
      if (!operations) validatedOperations.set(source, (operations = new Set()));
      operations.add(target);
    }
  }

  const built = { byId, actOf, validatedOperations };
  cache.set(model, built);
  return built;
}

const labelOf = (entity) => entity?.data?.id ?? entity?.displayId ?? entity?.id ?? '?';

/** A test case whose act invokes an operation it does not list under `validates.operations`. */
export const testCaseActNotValidated = (model, subject) => {
  const written = subject?.data?.when?.operation;
  if (typeof written !== 'string' || written.trim().length === 0) return { ok: true };

  const { byId, actOf, validatedOperations } = index(model);
  const act = actOf.get(subject.id);
  if (act === undefined) return { ok: true };
  const operation = byId.get(act);
  if (!operation || operation.type === PLACEHOLDER) return { ok: true };
  if (validatedOperations.get(subject.id)?.has(act)) return { ok: true };

  return {
    ok: false,
    context: {
      subject: labelOf(subject),
      subject_name: subject?.data?.name ?? subject?.name ?? subject?.displayId ?? '',
      operation: written,
    },
  };
};
