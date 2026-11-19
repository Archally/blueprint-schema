/** Portable, browser-safe evidence arithmetic. No model loading or endpoint inheritance. */
export const CENSUS_VERSION = 1;
export const CARRIERS = ['capable', 'none', 'unknown'];
export const RELATION_STATES = ['own-evidence', 'declared-without-evidence', 'supporting-record-only', 'derived-with-witnesses', 'no-carrier', 'unknown'];

export function evidenceItems(record) {
  return [record?.evidence, record?.provenance?.evidence]
    .flatMap(items => Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : []);
}

export function share(numerator, denominator) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator,
    label: denominator === 0 ? 'N/A' : `${numerator}/${denominator}` };
}

function increment(counts, key) {
  counts[key ?? 'not-stated'] = (counts[key ?? 'not-stated'] ?? 0) + 1;
}

/** A source string is a stated locator, never a verified source. SRC lookup is opt-in. */
function sourceStatus(item, registry) {
  const reference = item.source_ref ?? (/^(?:[a-z0-9-]+\.)*SRC\d+$/.test(item.source ?? '') ? item.source : null);
  if (reference) {
    if (!registry) {
      return 'registered-unavailable';
    }
    const matches = registry.filter(source => source.id === reference);
    if (matches.length === 0) {
      return 'broken';
    }
    if (matches.length > 1) {
      return 'ambiguous';
    }
    return 'registered-resolved';
  }
  return typeof item.source === 'string' && item.source.trim() !== '' ? 'locator-stated' : 'absent';
}

export function relationState(record) {
  if (record.evidence.length > 0) {
    return 'own-evidence';
  }
  if ((record.supportingEvidence ?? []).length > 0) {
    return 'supporting-record-only';
  }
  if (record.origin === 'derived' && (record.witnesses ?? []).length > 0) {
    return 'derived-with-witnesses';
  }
  if (record.carrier === 'none') {
    return 'no-carrier';
  }
  if (record.origin === 'declared' && record.carrier === 'capable') {
    return 'declared-without-evidence';
  }
  return 'unknown';
}

function summarize(records, registry, relations) {
  const result = {
    total: records.length, carrierCapable: 0, cannotState: 0, carrierUnknown: 0,
    withEvidence: 0, eligibleWithEvidence: 0, withTraceableSource: 0, directEvidenceItems: 0, noItems: 0,
    sources: { 'locator-stated': 0, absent: 0, broken: 0, ambiguous: 0, 'registered-resolved': 0, 'registered-unavailable': 0 },
    certaintyWithoutEvidence: 0, stageWithoutEvidence: 0, confirmedWithoutEvidence: 0,
    evidenceKinds: {}, confidenceImpacts: {}, discoveryStages: {}, certainties: {},
    weakeningItems: 0, invalidatingItems: 0, origins: {}, evidenceStates: {},
  };
  for (const record of records) {
    const items = record.evidence;
    result.carrierCapable += Number(record.carrier === 'capable');
    result.cannotState += Number(record.carrier === 'none');
    result.carrierUnknown += Number(record.carrier === 'unknown');
    result.withEvidence += Number(items.length > 0);
    result.eligibleWithEvidence += Number(items.length > 0 && record.carrier === 'capable');
    result.directEvidenceItems += items.length;
    result.noItems += Number(items.length === 0);
    result.withTraceableSource += Number(items.some(item => ['locator-stated', 'registered-resolved'].includes(sourceStatus(item, registry))));
    result.certaintyWithoutEvidence += Number(Boolean(record.certainty) && items.length === 0);
    result.stageWithoutEvidence += Number(Boolean(record.discoveryStage) && items.length === 0);
    result.confirmedWithoutEvidence += Number(record.certainty === 'confirmed' && items.length === 0);
    increment(result.certainties, record.certainty);
    increment(result.discoveryStages, record.discoveryStage);
    for (const item of items) {
      result.sources[sourceStatus(item, registry)]++;
      increment(result.evidenceKinds, item.kind);
      increment(result.confidenceImpacts, item.confidence_impact);
      result.weakeningItems += Number(item.confidence_impact === 'weakens');
      result.invalidatingItems += Number(item.confidence_impact === 'invalidates');
    }
    if (relations) {
      increment(result.origins, record.origin ?? 'unknown');
      increment(result.evidenceStates, relationState(record));
    }
  }
  return { ...result, allObjectShare: share(result.withEvidence, result.total),
    carrierEligibleShare: share(result.eligibleWithEvidence, result.carrierCapable) };
}

function population(records, registry, relations = false) {
  const group = field => [...new Set(records.map(record => record[field] ?? 'unknown'))].sort()
    .map(key => ({ key, ...summarize(records.filter(record => (record[field] ?? 'unknown') === key), registry, relations) }));
  return { ...summarize(records, registry, relations), byType: group('type'), bySlice: group('slice'),
    ...(relations ? { byFamily: group('family') } : {}) };
}

/** Versioned join identity deliberately excludes evaluation time. */
export function validateGraphInput(input, scope) {
  if (input?.contractVersion !== CENSUS_VERSION) {
    throw new Error('graph-census contract version mismatch');
  }
  for (const key of ['project', 'modelState', 'schemaVersion', 'fileSetIdentity']) {
    if (input.scope?.[key] !== scope[key]) {
      throw new Error(`graph-census ${key} mismatch`);
    }
  }
  if (!input.scope?.selection || typeof input.scope.selection !== 'object' || Array.isArray(input.scope.selection)) {
    throw new Error('graph-census selection mismatch');
  }
  const normalizedSelection = selection => Object.keys(scope.selection).sort().map(key => [key, selection?.[key] ?? null]);
  if (JSON.stringify(normalizedSelection(input.scope?.selection)) !== JSON.stringify(normalizedSelection(scope.selection))) {
    throw new Error('graph-census selection mismatch');
  }
  for (const key of ['entities', 'relations']) {
    if (!Array.isArray(input[key])) {
      throw new Error(`graph-census ${key} must be an array`);
    }
    const ids = new Set();
    for (const record of input[key]) {
      if (!record || typeof record.id !== 'string' || ids.has(record.id) || typeof record.name !== 'string'
        || typeof record.type !== 'string' || typeof record.slice !== 'string'
        || !CARRIERS.includes(record.carrier) || !Array.isArray(record.evidence)
        || record.evidence.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error(`graph-census invalid or duplicate ${key} record`);
      }
      if (scope.selection.slice && record.slice !== scope.selection.slice) {
        throw new Error('graph-census row slice mismatch');
      }
      if (scope.selection.type && record.type !== scope.selection.type) {
        throw new Error('graph-census row type mismatch');
      }
      if (key === 'relations' && scope.selection.family && record.family !== scope.selection.family) {
        throw new Error('graph-census row family mismatch');
      }
      if (scope.selection.file && record.file !== scope.selection.file) {
        throw new Error('graph-census row file mismatch');
      }
      if (scope.selection.files && !scope.selection.files.includes(record.file)) {
        throw new Error('graph-census row files mismatch');
      }
      if (scope.selection.entityIds && !scope.selection.entityIds.includes(record.declarationId)) {
        throw new Error('graph-census row entity mismatch');
      }
      ids.add(record.id);
    }
  }
}

export function measureEvidence({ scope, declarations, relationDeclarations = [], graphInput, sourceRegistry, fieldCompleteness = [] }) {
  if (graphInput) {
    validateGraphInput(graphInput, scope);
  }
  return {
    contractVersion: CENSUS_VERSION, scope,
    definitions: {
      evidence: 'Recorded items, not truth or real-world completeness.',
      source: 'Nonempty locator, not checked accessibility, relevance or independent corroboration.',
      dimensions: 'Type, slice and family overlap; do not add their tables together.',
      raw: 'Schema-routed typed declarations; relation declarations are separate from extracted relation instances.',
      origin: 'origin_ref locates a declaration; it does not establish inference.',
    },
    raw: { entities: population(declarations, sourceRegistry), relations: population(relationDeclarations, sourceRegistry, true) },
    graph: graphInput ? { status: 'available', entities: population(graphInput.entities, sourceRegistry),
      relations: population(graphInput.relations, sourceRegistry, true) }
      : { status: 'unavailable', reason: 'No matching extracted graph-census input supplied.', entities: null, relations: null },
    fieldCompleteness,
    openKnowledge: ['inquiry', 'question', 'assumption'].map(type => ({ type,
      total: declarations.filter(record => record.type === type).length,
      open: declarations.filter(record => record.type === type && record.open === true).length,
      unknown: declarations.filter(record => record.type === type && record.open == null).length })),
    codeReferences: { status: 'not-checked', references: declarations.reduce((sum, record) => sum + (record.codeRefCount ?? 0), 0) },
    validationRuns: Object.fromEntries(['V0', 'V1', 'V2', 'V3', 'V4', 'V5'].map(level => [level, { status: 'not-checked' }])),
    registeredReferences: { status: sourceRegistry ? 'available' : 'unavailable' },
  };
}

/** Collection dates measure age, never source verification. Explicit policies alone set deadlines. */
export const BLUEPRINT_EVIDENCE_KINDS = ['interview', 'survey', 'analytics', 'stakeholder-signoff',
  'competitive-analysis', 'codebase-analysis', 'documentation', 'assumption', 'experiment', 'workshop'];

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? value : null;
}

/** Policy schema: {id: nonempty string, daysByKind: {[supported kind]: nonnegative integer}}. */
export function validateFreshnessPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).some(key => !['id', 'daysByKind'].includes(key))
    || typeof policy.id !== 'string' || !policy.id.trim()
    || !policy.daysByKind || typeof policy.daysByKind !== 'object' || Array.isArray(policy.daysByKind)) {
    throw new Error('Invalid freshness policy: expected {id, daysByKind}');
  }
  for (const [kind, days] of Object.entries(policy.daysByKind)) {
    if (!BLUEPRINT_EVIDENCE_KINDS.includes(kind) || !Number.isSafeInteger(days) || days < 0 || days > 3652058) {
      throw new Error(`Invalid freshness policy daysByKind: ${kind}`);
    }
  }
  return { id: policy.id, daysByKind: Object.fromEntries(Object.entries(policy.daysByKind).sort()) };
}

export function classifyBlueprintEvidence(item, { nowISO, warnDays = 30, staleDays = 1825, policy = null }) {
  if (!calendarDate(nowISO)) {
    throw new Error('Invalid evaluation date; expected a calendar YYYY-MM-DD');
  }
  const selectedPolicy = policy === null ? null : validateFreshnessPolicy(policy);
  const observationDate = calendarDate(item.date);
  const supportedKind = BLUEPRINT_EVIDENCE_KINDS.includes(item.kind);
  const shelfLifeDays = supportedKind ? selectedPolicy?.daysByKind[item.kind] ?? null : null;
  const ageDays = observationDate === null ? null : Math.round((Date.parse(nowISO) - Date.parse(observationDate)) / 86400000);
  const deadlineMilliseconds = observationDate !== null && shelfLifeDays !== null
    ? Date.parse(observationDate) + shelfLifeDays * 86400000 : null;
  const deadlineDate = deadlineMilliseconds === null ? null : new Date(deadlineMilliseconds).toISOString().slice(0, 10);
  const reviewBy = calendarDate(deadlineDate);
  if (deadlineMilliseconds !== null && reviewBy === null) {
    throw new Error('Freshness policy deadline exceeds calendar YYYY-MM-DD range');
  }
  const daysToReview = reviewBy === null ? null : Math.round((Date.parse(reviewBy) - Date.parse(nowISO)) / 86400000);
  const findings = [];
  if (!supportedKind) {
    findings.push('UNSUPPORTED_KIND');
  }
  if (item.date != null && observationDate === null) {
    findings.push('INVALID_DATE');
  }
  let category = 'NO_DATE';
  if (observationDate !== null) {
    category = ageDays > staleDays ? 'AGED_NO_POLICY' : 'NO_POLICY';
  }
  if (daysToReview !== null) {
    category = daysToReview < 0 ? 'EXPIRED' : daysToReview <= warnDays ? 'EXPIRING' : 'FRESH';
  }
  if (findings.includes('INVALID_DATE')) {
    category = 'INVALID_DATE';
  }
  return { kind: item.kind ?? null, observationDate, rawDate: item.date ?? null, shelfLifeDays, reviewBy,
    ageDays, daysToReview, category, findings, evaluatedAt: nowISO,
    policy: selectedPolicy, sourceResolution: 'unavailable' };
}
