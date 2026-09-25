/**
 * A process declares an end state the model says none of its activities can produce.
 *
 * The link, and why it is the only honest one available. An end state is a `name` and a `type`;
 * an activity carries operations. Neither names the other, so "this activity ends in that state"
 * is not something the model can say, and a rule cannot read it. What the model CAN say is a
 * chain of four statements it already makes independently:
 *
 *   1. a concept declares a lifecycle state, and a transition rule moves INTO it (`to:`);
 *   2. an operation declares that it is `governed_by` that transition rule, which is the model's
 *      statement that this operation is what makes the move;
 *   3. a process's activities name the operations they run;
 *   4. the end state's own NAME names the lifecycle state.
 *
 * Where all four hold and the process names none of the operations that make the move, the model
 * contradicts itself: it declares an outcome and, in the same breath, lists every operation the
 * process runs without including the one that produces it.
 *
 * Step 4 is a name comparison, which is the weak link, so it is made as literal as possible: the
 * end-state name is split into lowercase word tokens and must contain the state's own tokens in
 * order and adjacent. "Order Confirmed" names the state `confirmed`; "Insufficient Stock" names no
 * state of any concept and the rule stays silent on it. This is what keeps the rule from guessing:
 * an end state whose name is prose rather than a state is simply not something it speaks about.
 *
 * Four guards make silence the default, because each absence is a different gap that belongs to a
 * different layer:
 *
 *   - no transition rule moves into a state the end state's name contains: nothing to check;
 *   - no operation anywhere is `governed_by` such a transition: the domain layer has not said which
 *     operation makes the move, so the process cannot be faulted for omitting it;
 *   - the process never touches the concept whose state was matched, which it does by an operation
 *     that `materializes` that concept or that is `governed_by` another of its transitions. This is
 *     what separates a state from a word: "Return accepted for processing" contains the token
 *     `processing`, and where the process runs nothing that touches the concept declaring that
 *     state, the match is prose and the rule says nothing;
 *   - the process names no operations at all: `activity-without-entry-operation` owns that.
 *
 * The end state's `type` does not change the test. `type` says how a process stops (`complete`,
 * `error`, `cancel`, `terminate`) and the chain above says whether an operation exists that puts
 * the concept into the named state; an `error` end state named after a lifecycle state needs an
 * operation that reaches it exactly as a `complete` one does. What keeps error and cancellation
 * branches quiet is step 4, not the type: an end state describing a failure in prose names no
 * state and is never reported. The type is carried into the message so a reader can judge the
 * report, and a project that wants only completing outcomes checked narrows the rule in
 * `.blueprint-lint.yaml`.
 *
 * What it cannot detect: an end state whose name does not contain a declared lifecycle state, a
 * model whose operations declare neither `governed_by` nor `materializes`, and an outcome that is
 * not a state of any concept at all. Those are silence, not a pass.
 */

/** @param {unknown} value @returns {string[]} lowercase word tokens */
function tokens(value) {
  if (typeof value !== 'string') return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when `needle` appears in `haystack` in order and adjacent. */
function containsSequence(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let hit = true;
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[start + offset] !== needle[offset]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** @param {unknown} entity @returns {Record<string, unknown>} */
function dataOf(entity) {
  const data = entity && typeof entity === 'object' ? /** @type {Record<string, unknown>} */ (entity).data : null;
  return data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {};
}

/**
 * Every operation entity id this process names, read from both shapes the process carries: the
 * flattened step list the model builder writes, and the activities' own `entry_operation`, which
 * the flattened list leaves out when an activity also declares steps.
 */
function processOperationIds(subject, byDisplay) {
  const data = dataOf(subject);
  const ids = new Set();
  const detail = Array.isArray(data.operationsDetail) ? data.operationsDetail : [];
  for (const step of detail) {
    if (!step || typeof step !== 'object') continue;
    if (typeof step.resolvedEntityId === 'string') ids.add(step.resolvedEntityId);
    if (typeof step.fallbackEntityId === 'string') ids.add(step.fallbackEntityId);
  }
  const activities = Array.isArray(data.activities) ? data.activities : [];
  for (const activity of activities) {
    if (!activity || typeof activity !== 'object') continue;
    const ref = activity.entry_operation;
    if (typeof ref !== 'string' || !ref) continue;
    const named = byDisplay.get(ref);
    if (named) ids.add(named.id);
    const dot = ref.indexOf('.');
    if (dot > 0) {
      const bare = byDisplay.get(ref.slice(dot + 1));
      if (bare) ids.add(bare.id);
    }
  }
  return ids;
}

function label(entity, fallback) {
  return entity && typeof entity.displayId === 'string' && entity.displayId ? entity.displayId : fallback;
}

/**
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function processEndStateUnreachable(model, subject) {
  const endStates = dataOf(subject).end_states;
  if (!Array.isArray(endStates) || endStates.length === 0) return { ok: true };

  const entities = model.entities ?? [];
  const byId = new Map();
  const byDisplay = new Map();
  for (const entity of entities) {
    byId.set(entity.id, entity);
    if (entity.type === 'Missing') continue;
    if (typeof entity.displayId === 'string' && entity.displayId && !byDisplay.has(entity.displayId)) {
      byDisplay.set(entity.displayId, entity);
    }
  }
  // A bare display id is only a usable alias where it names one entity; where two contexts both
  // declare CMD001 it names neither, and the scoped form is what the model was written with.
  const bareCount = new Map();
  for (const entity of entities) {
    if (typeof entity.displayId !== 'string') continue;
    const dot = entity.displayId.indexOf('.');
    if (dot <= 0) continue;
    const bare = entity.displayId.slice(dot + 1);
    bareCount.set(bare, (bareCount.get(bare) ?? 0) + 1);
  }
  for (const entity of entities) {
    if (typeof entity.displayId !== 'string') continue;
    const dot = entity.displayId.indexOf('.');
    if (dot <= 0) continue;
    const bare = entity.displayId.slice(dot + 1);
    if (bareCount.get(bare) === 1 && !byDisplay.has(bare)) byDisplay.set(bare, entity);
  }

  const transitions = entities.filter((entity) => entity.type === 'TransitionRule');
  if (transitions.length === 0) return { ok: true };

  // Which operation is declared to make each move. A transition nothing is governed_by is a move
  // the model has not attached to an operation, and no process can be faulted for omitting it.
  const makersOf = new Map();
  for (const relation of model.relations ?? []) {
    if (relation.type !== 'governed_by') continue;
    const source = relation.source ?? relation.source_entity_id;
    const target = relation.target ?? relation.target_entity_id;
    if (typeof source !== 'string' || typeof target !== 'string') continue;
    const operation = byId.get(source);
    if (!operation || operation.type !== 'Operation') continue;
    if (!makersOf.has(target)) makersOf.set(target, new Set());
    makersOf.get(target).add(source);
  }

  const named = processOperationIds(subject, byDisplay);
  if (named.size === 0) return { ok: true };

  // Which concepts this process touches, read from the two statements an operation makes about a
  // concept: it materializes it, or it is governed by one of that concept's transitions. A state
  // name matched on a concept the process never touches is a word in a sentence, not a state.
  const conceptOf = (ref) => {
    if (typeof ref !== 'string' || !ref) return undefined;
    const direct = byDisplay.get(ref);
    if (direct) return direct.id;
    const dot = ref.indexOf('.');
    if (dot > 0) {
      const bare = byDisplay.get(ref.slice(dot + 1));
      if (bare) return bare.id;
    }
    return undefined;
  };
  const touched = new Set();
  for (const operationId of named) {
    const operation = byId.get(operationId);
    if (!operation || operation.type !== 'Operation') continue;
    const materializes = dataOf(operation).materializes;
    if (Array.isArray(materializes)) {
      for (const entry of materializes) {
        if (!entry || typeof entry !== 'object') continue;
        const id = conceptOf(entry.concept);
        if (id) touched.add(id);
      }
    }
  }
  for (const relation of model.relations ?? []) {
    if (relation.type !== 'governed_by') continue;
    const source = relation.source ?? relation.source_entity_id;
    const target = relation.target ?? relation.target_entity_id;
    if (!named.has(source)) continue;
    const transition = byId.get(target);
    if (!transition || transition.type !== 'TransitionRule') continue;
    const id = conceptOf(dataOf(transition).concept);
    if (id) touched.add(id);
  }
  if (touched.size === 0) return { ok: true };

  for (const endState of endStates) {
    if (!endState || typeof endState !== 'object') continue;
    const endStateName = typeof endState.name === 'string' ? endState.name : '';
    if (!endStateName) continue;
    const endStateTokens = tokens(endStateName);

    const matched = transitions.filter((transition) => {
      const data = dataOf(transition);
      const concept = conceptOf(data.concept);
      if (!concept || !touched.has(concept)) return false;
      const stateTokens = tokens(data.to);
      return stateTokens.length > 0 && containsSequence(endStateTokens, stateTokens);
    });
    if (matched.length === 0) continue;

    const makers = new Set();
    for (const transition of matched) {
      for (const operation of makersOf.get(transition.id) ?? []) makers.add(operation);
    }
    if (makers.size === 0) continue;

    let reached = false;
    for (const operation of makers) {
      if (named.has(operation)) {
        reached = true;
        break;
      }
    }
    if (reached) continue;

    const first = matched[0];
    const state = String(dataOf(first).to ?? '');
    const conceptRef = dataOf(first).concept;
    const concept = typeof conceptRef === 'string' ? conceptRef : 'its concept';
    return {
      ok: false,
      context: {
        end_state: endStateName,
        end_state_type: typeof endState.type === 'string' ? endState.type : 'unstated',
        state,
        concept,
        transitions: [...matched].map((transition) => label(transition, transition.id)).join(', '),
        makers: [...makers].map((id) => label(byId.get(id), id)).join(', '),
      },
    };
  }

  return { ok: true };
}
