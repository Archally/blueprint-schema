/**
 * A service's two dependency lists name two different kinds of target.
 *
 * `imports` names the libraries a service is built on: a package it imports, a component it embeds.
 * `uses` names the services it depends on while running. The model builder draws one
 * `service_imports` or `service_uses` edge per resolved item, Service -> Service. The two checks
 * here compare each item with the `kind` its target STATES:
 *
 *   - an `imports` item whose target states a kind other than `library` names something that runs,
 *     not something a build contains;
 *   - a `uses` item whose target states `kind: library` names something a build contains, not
 *     something that runs.
 *
 * SILENT WHERE THE TARGET STATES NO KIND. `kind` is optional on a service, so a target without one
 * says nothing either check could compare with, and guessing would report missing data as a wrong
 * statement. One target named in both lists therefore yields exactly one finding when it states a
 * kind, and none when it does not.
 *
 * A SELF-REFERENCE IS NOT JUDGED HERE. A service naming itself in `imports` is a cycle, which
 * `imports-cycle` reports with the fix that applies (remove it); suggesting "move it to `uses`" as
 * well would give one item two findings with different fixes. A service naming itself in `uses` is
 * not reported anywhere: it puts a service in its own impact set, where it already is.
 *
 * One finding per service, naming every target that disagrees, sorted by id: the engine runs a
 * check once per subject and a check reports at most once.
 */

const IMPORTS = 'service_imports';
const USES = 'service_uses';
const SERVICE = 'Service';
const LIBRARY = 'library';

const cache = new WeakMap();

function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Map<string, any>} every service by its entity id. */
  const services = new Map();
  for (const entity of model.entities ?? []) {
    if (entity.type === SERVICE) services.set(entity.id, entity);
  }

  /** @type {Map<string, Map<string, Set<string>>>} relation type -> source -> targets. */
  const targets = new Map([
    [IMPORTS, new Map()],
    [USES, new Map()],
  ]);
  for (const relation of model.relations ?? []) {
    const bySource = targets.get(relation.type);
    if (!bySource) continue;
    if (!services.has(relation.source) || !services.has(relation.target)) continue;
    const set = bySource.get(relation.source) ?? new Set();
    set.add(relation.target);
    bySource.set(relation.source, set);
  }

  const built = { services, targets };
  cache.set(model, built);
  return built;
}

/** The id the author wrote (`shop.SVC002`), which is what a reader searches the files for. */
function declaredId(entity) {
  const id = entity?.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : entity?.id ?? '';
}

function nameOf(entity) {
  return entity?.data?.name ?? entity?.name ?? entity?.displayId ?? declaredId(entity);
}

function statedKind(entity) {
  const kind = entity?.data?.kind;
  return typeof kind === 'string' && kind.length > 0 ? kind : undefined;
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The targets of `relationType` from `subject` whose stated kind `disagrees`, as message labels
 * sorted by declared id, or an empty list.
 */
function disagreeing(model, subject, relationType, disagrees) {
  const state = index(model);
  const found = [];
  for (const targetId of state.targets.get(relationType).get(subject.id) ?? []) {
    if (targetId === subject.id) continue;
    const target = state.services.get(targetId);
    const kind = statedKind(target);
    if (kind === undefined || !disagrees(kind)) continue;
    found.push({ id: declaredId(target), label: `${declaredId(target)} "${nameOf(target)}" (kind: ${kind})` });
  }
  found.sort((a, b) => byCodeUnit(a.id, b.id));
  return found.map((item) => item.label);
}

/** An `imports` item whose service states a kind other than `library`. */
export const importsTargetNotLibrary = (model, subject) => {
  const targets = disagreeing(model, subject, IMPORTS, (kind) => kind !== LIBRARY);
  if (targets.length === 0) return { ok: true };
  return {
    ok: false,
    context: {
      service: declaredId(subject),
      service_name: nameOf(subject),
      targets: targets.join(', '),
    },
  };
};

/** A `uses` item whose service states `kind: library`. */
export const usesTargetIsLibrary = (model, subject) => {
  const targets = disagreeing(model, subject, USES, (kind) => kind === LIBRARY);
  if (targets.length === 0) return { ok: true };
  return {
    ok: false,
    context: {
      service: declaredId(subject),
      service_name: nameOf(subject),
      targets: targets.join(', '),
    },
  };
};
