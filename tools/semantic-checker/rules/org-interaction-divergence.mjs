/**
 * A declared organizational dependency, checked against the one the architecture already states.
 *
 * `interacts_with` lets a team or department declare a dependency on another. Five of its six
 * `nature` values name dependencies nothing can derive - an approval, a consultation, a team raising
 * another's capability - and those are the point of the field. The sixth, `architectural`, claims
 * something the model states independently:
 *
 *     team <--owned_by-- context --context_depends_on--> context --owned_by--> team
 *
 * so a declared architectural edge and the derived one can disagree, and one of the two is then
 * stale. That comparison is what makes `nature` worth requiring, and it is what these rules do.
 *
 * **Three states are NOT a disagreement**, and telling them apart is most of this file. A dependency
 * naming a context nothing declares, a context nobody owns, and a unit that owns no context at all
 * each leave the chain unwalkable. Reporting any of them as a divergence would blame the model for a
 * walk the derivation could not finish, so a unit whose chain is incomplete is reported as
 * unverifiable and never as divergent.
 *
 * Three exports, one derivation: what disagrees, what could not be checked, and what the
 * architecture states that nobody wrote down.
 */

const INTERACTS_WITH = 'interacts_with';
const OWNED_BY = 'owned_by';
const CONTEXT_DEPENDS_ON = 'context_depends_on';
const ARCHITECTURAL = 'architectural';

const CONTEXT = 'Context';
const MISSING = 'Missing';
const OWNER_TYPES = new Set(['Team', 'Department']);

/** One derivation per model, however many subjects the engine walks. */
const cache = new WeakMap();

const keyOf = (entity) => entity?.displayId ?? entity?.id;

/**
 * Who owns each context, keyed by the context's NAME and unioned across its declarations.
 *
 * A context is re-declared by every slice that takes part in it, the way a party is, so one name
 * reaches several Context entities with separate ids. Keyed on the id, a dependency resolved to one
 * declaration cannot find an owner stated on another, and the chain breaks at the join for reasons
 * that have nothing to do with the model. Keyed on the name it survives.
 *
 * Where those declarations name DIFFERENT owners the union holds all of them, which makes the check
 * lenient: a declared edge to any of them counts as derived. That is the safe direction, because the
 * failure this rule must not have is calling a correct statement a divergence.
 */
function ownersByContextName(model, entityById) {
  const owners = new Map();
  for (const relation of model.relations) {
    if (relation.type !== OWNED_BY) continue;
    const context = entityById.get(relation.source);
    const owner = entityById.get(relation.target);
    if (context?.type !== CONTEXT || !OWNER_TYPES.has(owner?.type)) continue;
    const name = keyOf(context);
    if (!owners.has(name)) owners.set(name, new Set());
    owners.get(name).add(keyOf(owner));
  }
  return owners;
}

/**
 * The dependencies between org units that the architecture states, and where the walk stopped.
 *
 * `blocked` maps an owner to the reasons its own chain is incomplete. An owner with any entry there
 * has a derived set that is a floor rather than an answer, so nothing it declares can be called a
 * divergence.
 */
function derive(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  const entityById = new Map(model.entities.map((entity) => [entity.id, entity]));
  const owners = ownersByContextName(model, entityById);

  const derived = new Map();
  const blocked = new Map();
  const note = (owner, reason) => {
    if (!blocked.has(owner)) blocked.set(owner, new Set());
    blocked.get(owner).add(reason);
  };

  for (const dependency of model.relations) {
    if (dependency.type !== CONTEXT_DEPENDS_ON) continue;
    const from = entityById.get(dependency.source);
    const to = entityById.get(dependency.target);
    const fromOwners = owners.get(keyOf(from));
    if (!fromOwners) continue; // the declaring context has no owner; nothing to attribute it to

    if (to?.type === MISSING) {
      for (const owner of fromOwners) note(owner, `'${keyOf(to)}' names no declared context`);
      continue;
    }
    const toOwners = owners.get(keyOf(to));
    if (!toOwners) {
      for (const owner of fromOwners) note(owner, `context '${keyOf(to)}' has no declared owner`);
      continue;
    }
    for (const source of fromOwners) {
      for (const target of toOwners) {
        if (source === target) continue;
        if (!derived.has(source)) derived.set(source, new Set());
        derived.get(source).add(target);
      }
    }
  }

  // A unit that owns no context has no chain at all, which is the third way the walk stops. It is
  // recorded here rather than at each declaration site so every export reads one answer.
  const ownsSomething = new Set();
  for (const set of owners.values()) for (const owner of set) ownsSomething.add(owner);
  for (const entity of model.entities) {
    if (!OWNER_TYPES.has(entity.type)) continue;
    if (!ownsSomething.has(keyOf(entity))) note(keyOf(entity), 'owns no bounded context');
  }

  const result = { derived, blocked, entityById };
  cache.set(model, result);
  return result;
}

/** The `architectural` edges this subject declares, as target keys. */
function declaredArchitectural(subject, entityById) {
  const targets = [];
  const declared = subject?.data?.[INTERACTS_WITH];
  if (!Array.isArray(declared)) return targets;
  for (const edge of declared) {
    if (!edge || typeof edge !== 'object' || edge.nature !== ARCHITECTURAL) continue;
    for (const arm of ['team_ref', 'department_ref', 'party_ref']) {
      if (typeof edge[arm] === 'string' && edge[arm] !== '') targets.push(edge[arm]);
    }
  }
  return targets;
}

/**
 * The subject claims an architectural dependency the architecture does not show.
 *
 * Silent unless the subject's own chain is complete, so an unwalkable model never produces one of
 * these. Reads the declaration from `data` rather than from the `interacts_with` edges, because the
 * edge resolves its target to a placeholder when nothing declares it and the placeholder's key is
 * not what the model wrote.
 */
export const orgInteractionDivergesFromArchitecture = (model, subject) => {
  if (!subject) return { ok: true };
  const { derived, blocked, entityById } = derive(model);
  const self = keyOf(subject);
  if (blocked.has(self)) return { ok: true }; // unverifiable, and its own rule says so

  const claimed = declaredArchitectural(subject, entityById);
  if (claimed.length === 0) return { ok: true };

  const reached = derived.get(self) ?? new Set();
  const missing = claimed.filter((target) => !reached.has(target));
  if (missing.length === 0) return { ok: true };

  return { ok: false, context: { targets: missing } };
};

/**
 * The subject declares an architectural dependency and its chain cannot be walked.
 *
 * Not a defect in the declaration and not a defect in the architecture: it says the comparison did
 * not happen. Without it, a unit whose chain is broken looks exactly like one whose declarations all
 * agree - which is the failure this rule set exists to avoid making.
 */
export const orgInteractionUnverifiable = (model, subject) => {
  if (!subject) return { ok: true };
  const { blocked, entityById } = derive(model);
  const reasons = blocked.get(keyOf(subject));
  if (!reasons) return { ok: true };
  if (declaredArchitectural(subject, entityById).length === 0) return { ok: true };
  return { ok: false, context: { reasons: [...reasons] } };
};

/**
 * The architecture shows a dependency the subject did not declare.
 *
 * Gated on the subject having declared at least one architectural edge. A unit that declares none has
 * not adopted the construct, and telling it about every dependency the architecture already draws is
 * advertising a feature rather than reporting a gap. Once a unit keeps such a list, one it left out
 * is a gap in that list.
 */
export const orgInteractionUnderived = (model, subject) => {
  if (!subject) return { ok: true };
  const { derived, blocked, entityById } = derive(model);
  const self = keyOf(subject);
  if (blocked.has(self)) return { ok: true };

  const claimed = new Set(declaredArchitectural(subject, entityById));
  if (claimed.size === 0) return { ok: true };

  const undeclared = [...(derived.get(self) ?? [])].filter((target) => !claimed.has(target));
  if (undeclared.length === 0) return { ok: true };

  return { ok: false, context: { targets: undeclared.sort() } };
};
