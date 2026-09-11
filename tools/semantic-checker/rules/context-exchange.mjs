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
  /** @type {Map<string, {protocols: string[], operationCount: number}>} derived, `consumer>provider`. */
  const derived = new Map();
  const names = new Map();

  for (const entity of model.entities ?? []) {
    names.set(entity.id, entity.displayId ?? entity.name ?? entity.id);
  }

  for (const relation of model.relations ?? []) {
    if (relation.type === DEPENDS_ON) {
      declared.add(`${relation.source}>${relation.target}`);
    } else if (relation.type === TRAFFIC) {
      const data = relation.data ?? {};
      derived.set(`${relation.source}>${relation.target}`, {
        protocols: Array.isArray(data.protocols) ? data.protocols : [],
        operationCount: typeof data.operation_count === 'number' ? data.operation_count : 0,
      });
    }
  }

  const built = { declared, derived, names };
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
