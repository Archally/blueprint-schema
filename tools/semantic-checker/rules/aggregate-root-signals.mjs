/**
 * Whether a command reaches an aggregate root.
 *
 * Not expressible in the rule DSL: reaching is a path of up to two hops that starts at an operation
 * of one kind (a command naming a rule that names the root), and the DSL tests one entity's fields
 * or one relation's presence. The check reads only relations the model builder derives, so both
 * shapes of `operations`, both spellings of an operation reference and both rule shapes (a
 * `concepts` list, a transition rule's `concept`) are resolved once, by the builder.
 *
 * `states` and an owned `contains` relationship are reported in the message and never decide the
 * verdict: a stateless root, or one whose parts are modelled elsewhere, is a legitimate root.
 */

const COMMAND = 'command';
const OPERATION = 'Operation';
const MATERIALIZES = 'materializes';
/** Edges from a command to a rule it obeys or states. */
const RULE_EDGES = new Set(['governed_by', 'preconditions', 'postconditions']);
/** Edges from a rule to the concepts it is about. */
const ABOUT_EDGES = new Set(['concepts', 'concept']);

/** Model -> the ids of every concept some command reaches, computed once per model. */
const cache = new WeakMap();

function reachedConcepts(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  const commands = new Set();
  for (const entity of model.entities ?? []) {
    if (entity.type === OPERATION && entity.data?.kind === COMMAND) commands.add(entity.id);
  }

  /** Rule id -> the concept ids it is about. */
  const about = new Map();
  for (const relation of model.relations ?? []) {
    if (!ABOUT_EDGES.has(relation.type)) continue;
    const concepts = about.get(relation.source) ?? new Set();
    concepts.add(relation.target);
    about.set(relation.source, concepts);
  }

  const reached = new Set();
  for (const relation of model.relations ?? []) {
    if (!commands.has(relation.source)) continue;
    if (relation.type === MATERIALIZES) reached.add(relation.target);
    else if (RULE_EDGES.has(relation.type)) {
      for (const concept of about.get(relation.target) ?? []) reached.add(concept);
    }
  }

  cache.set(model, reached);
  return reached;
}

/** @param {Record<string, unknown>} data */
function hasStates(data) {
  return Array.isArray(data.states) && data.states.length > 0;
}

/** @param {Record<string, unknown>} data */
function ownsContains(data) {
  return Array.isArray(data.relationships)
    && data.relationships.some((relationship) => relationship && relationship.predicate === 'contains');
}

/**
 * One finding per aggregate root no command reaches, with whether it has states and owns a
 * `contains` relationship as detail.
 *
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export const aggregateRootCommandEntry = (model, subject) => {
  if (!subject || reachedConcepts(model).has(subject.id)) return { ok: true };
  const data = subject.data ?? {};
  return {
    ok: false,
    context: {
      states: hasStates(data) ? 'has states' : 'has no states',
      contains: ownsContains(data) ? 'owns a `contains` relationship' : 'has no owned `contains` relationship',
    },
  };
};
