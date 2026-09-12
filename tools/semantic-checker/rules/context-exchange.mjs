/**
 * Declaration and derivation are two sources over one proposition, and where they disagree the
 * model is saying two things. This module reports the three ways that happens between bounded
 * contexts. It never resolves them: an author knows something the contracts do not, and a contract
 * records something an author forgot, and nothing here can tell which.
 *
 * THE TWO SOURCES
 *   · `context_depends_on` is DECLARED - a `dependency` entry an author wrote. It is primary, and
 *     it stays primary: measured across this corpus, 46 derived pairs stand against 352 declared,
 *     and four of the six models with a context map derive nothing at all. A derivation that finds
 *     nothing returns the empty set, which is indistinguishable from "there is nothing there", so
 *     promoting derivation to the only source would turn every unauthored contract into a denial.
 *   · `contract_traffic` is DERIVED - one context's service calls an operation another's exposes.
 *     It carries the protocol, the operations and the broker, which a declaration cannot.
 *
 * WHY THIS IS A CUSTOM CHECK RATHER THAN A FILTER. The rule language selects relations and the
 * adapter passes their `data` through, but `field_eq` and `field_in` are applied only to ENTITY
 * subjects - on a relation subject the filter is skipped and every relation of that type matches.
 * A rule shaped as a relation filter would therefore fire on every pair rather than the
 * disagreeing ones. Each check below takes a Context as its subject and does the join itself.
 *
 * EACH PAIR IS REPORTED ONCE, from the end that owns the claim: an undeclared exchange from the
 * consumer, an unevidenced dependency from the context that declared it. Reporting from both ends
 * would double every count in the report.
 */

const DEPENDS_ON = 'context_depends_on';
const TRAFFIC = 'contract_traffic';

/** One index per model, however many contexts the engine walks. */
const cache = new WeakMap();

function index(model) {
  const cached = cache.get(model);
  if (cached) return cached;

  /** @type {Set<string>} declared pairs, as `source>target`. */
  const declared = new Set();
  /**
   * @type {Map<string, string>} the coupling an author declared on a pair, where they declared one.
   *
   * Kept beside `declared` rather than folded into it: the three rules below ask only whether a pair
   * was declared, and a set answers that in the shape they already read. A pair with no `coupling:`
   * is absent here, which is the distinction the fourth rule turns on.
   */
  const couplings = new Map();
  /** @type {Map<string, {protocols: string[], operationCount: number}>} derived, `consumer>provider`. */
  const derived = new Map();
  const names = new Map();

  for (const entity of model.entities ?? []) {
    names.set(entity.id, entity.displayId ?? entity.name ?? entity.id);
  }

  for (const relation of model.relations ?? []) {
    if (relation.type === DEPENDS_ON) {
      const pair = `${relation.source}>${relation.target}`;
      declared.add(pair);
      const coupling = relation.data?.coupling;
      if (typeof coupling === 'string' && coupling.length > 0) couplings.set(pair, coupling);
    } else if (relation.type === TRAFFIC) {
      const data = relation.data ?? {};
      derived.set(`${relation.source}>${relation.target}`, {
        protocols: Array.isArray(data.protocols) ? data.protocols : [],
        operationCount: typeof data.operation_count === 'number' ? data.operation_count : 0,
      });
    }
  }

  const built = { declared, couplings, derived, names };
  cache.set(model, built);
  return built;
}

/**
 * The engine's own placeholder set is fixed, so every name a message uses has to be supplied here.
 * `subject` and `subject_name` are the two every rule in this pack carries.
 */
function subjectOf(subject) {
  return {
    subject: subject?.displayId ?? subject?.id ?? '',
    subject_name: subject?.data?.name ?? subject?.name ?? subject?.displayId ?? '',
  };
}

/** A readable list of counterpart contexts, in a stable order. */
function label(names, ids) {
  return [...ids]
    .map((id) => names.get(id) ?? id)
    .sort()
    .join(', ');
}

/**
 * A pair the contracts prove and nobody declared.
 *
 * The highest-value finding here: the contracts already say these two contexts exchange operations,
 * and the context map a reader draws from `dependency` entries does not show it. Reported from the
 * CONSUMER, which is the context whose service makes the call and therefore the one whose
 * `dependencies` would carry the entry.
 */
export const undeclaredExchange = (model, subject) => {
  const { declared, derived, names } = index(model);
  const missing = new Map();

  for (const [pair, traffic] of derived) {
    const [consumer, provider] = pair.split('>');
    if (consumer !== subject?.id) continue;
    // Either direction of a declaration counts: an author who declared B depends on A has
    // recorded the coupling, even if they recorded it from the other end.
    if (declared.has(pair) || declared.has(`${provider}>${consumer}`)) continue;
    missing.set(provider, traffic);
  }

  if (missing.size === 0) return { ok: true };

  const operations = [...missing.values()].reduce((total, t) => total + t.operationCount, 0);
  const protocols = [...new Set([...missing.values()].flatMap((t) => t.protocols))].sort();
  return {
    ok: false,
    context: {
      ...subjectOf(subject),
      counterparts: label(names, missing.keys()),
      operations: String(operations),
      protocols: protocols.join(', ') || 'unknown',
    },
  };
};

/**
 * A declared dependency the contracts do not evidence.
 *
 * INFO, not warn, and the reason is a measurement: most of these are legitimate coupling the
 * contract surface cannot see yet - a shared database, a file drop, a scheduled job. On one model
 * 119 of 132 declared dependencies land here, and a report that fires 119 times is switched off
 * within a week. It promotes to a warning once the non-API contract kinds exist and the derivation
 * can see what it is currently blind to.
 */
export const unevidencedDependency = (model, subject) => {
  const { declared, derived, names } = index(model);
  const unevidenced = new Set();

  for (const pair of declared) {
    const [from, to] = pair.split('>');
    if (from !== subject?.id) continue;
    if (derived.has(pair) || derived.has(`${to}>${from}`)) continue;
    unevidenced.add(to);
  }

  if (unevidenced.size === 0) return { ok: true };
  return { ok: false, context: { ...subjectOf(subject), counterparts: label(names, unevidenced) } };
};

/**
 * A declared dependency whose direction the traffic contradicts.
 *
 * Small and precise: the pair is declared one way and every operation between the two flows the
 * other. Unlike the two above this is not a silence but a contradiction - one of the two statements
 * is wrong, and which one is a question for an author rather than for a tool.
 */
export const dependencyDirectionDisagreement = (model, subject) => {
  const { declared, derived, names } = index(model);
  const reversed = new Set();

  for (const pair of declared) {
    const [from, to] = pair.split('>');
    if (from !== subject?.id) continue;
    // The traffic runs the other way and does NOT also run this way.
    if (derived.has(`${to}>${from}`) && !derived.has(pair)) reversed.add(to);
  }

  if (reversed.size === 0) return { ok: true };
  return { ok: false, context: { ...subjectOf(subject), counterparts: label(names, reversed) } };
};

/**
 * A coupling stated twice: declared on the dependency, and already computed by the contracts.
 *
 * `coupling` exists for the connections the contract surface cannot see - a shared database, a file
 * drop, a scheduled job. Where the contracts DO reach the pair they are the better source, because
 * they carry the direction, the operations and the broker as well, and none of that survives being
 * restated as one word. Two sources over one proposition drift, and the model then says two things.
 *
 * Reported from the context that declared it, which is the end that owns the field and the end that
 * can delete it.
 *
 * Either direction of traffic counts. The claim is about the PAIR - the contracts compute a protocol
 * between these two contexts - and a declaration does not become a second source only when it points
 * the same way. Where the traffic runs the other way `dependency-direction-disagreement` also fires,
 * on a different defect with a different fix.
 *
 * Agreement and disagreement are ONE rule, not two. Deleting the declaration is the fix in both
 * cases, so splitting them would mean a model that corrects a contradiction by removing the field
 * immediately trips the other id - the tool moving while the author is acting on it.
 */
export const restatedCoupling = (model, subject) => {
  const { couplings, derived, names } = index(model);
  /** @type {Array<{ name: string, declared: string, computed: string[] }>} */
  const restated = [];

  for (const [pair, coupling] of couplings) {
    const [from, to] = pair.split('>');
    if (from !== subject?.id) continue;
    const traffic = derived.get(pair) ?? derived.get(`${to}>${from}`);
    if (!traffic) continue; // The only source. This is exactly what the field is for.
    restated.push({ name: names.get(to) ?? to, declared: coupling, computed: traffic.protocols });
  }

  if (restated.length === 0) return { ok: true };

  restated.sort((a, b) => a.name.localeCompare(b.name));
  const comparison = restated
    .map((entry) => {
      const computed = entry.computed.length > 0 ? entry.computed.join('/') : 'nothing';
      const agrees = entry.computed.includes(entry.declared);
      return `${entry.name}: declared "${entry.declared}", the contracts compute "${computed}"${
        agrees ? '' : ' - these disagree'
      }`;
    })
    .join('; ');

  return { ok: false, context: { ...subjectOf(subject), comparison } };
};
