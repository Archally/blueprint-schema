// @ts-check
/** Goal claims are source-owned; keep diagnostics at the authored assertion, never infer edges. */
export function goalRelationFindings(documents) {
  const declarations = new Map();
  const goals = [];
  function walk(node, file, path = []) {
    if (Array.isArray(node)) return node.forEach((item, index) => walk(item, file, [...path, index]));
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string') {
      const sites = declarations.get(node.id) ?? [];
      sites.push({ file, path });
      declarations.set(node.id, sites);
    }
    for (const [key, value] of Object.entries(node)) walk(value, file, [...path, key]);
  }
  for (const { relFile, data } of documents) {
    walk(data, relFile);
    if (!data || typeof data !== 'object' || !Array.isArray(data.goals)) continue;
    data.goals.forEach((goal, index) => {
      if (goal && typeof goal === 'object' && typeof goal.id === 'string') goals.push({ goal, file: relFile, index });
    });
  }
  const errors = [];
  const warnings = [];
  const claims = [];
  const seen = new Set();
  const add = (list, file, path, message) => list.push({ file, path, message: `[${file}] ${path}: ${message}` });
  for (const { goal, file, index } of goals) {
    if (!Array.isArray(goal.goal_relations)) continue;
    goal.goal_relations.forEach((claim, occurrence) => {
      if (!claim || typeof claim !== 'object') return;
      const path = `/goals/${index}/goal_relations/${occurrence}`;
      const target = claim.target_goal;
      const sites = declarations.get(target) ?? [];
      const targets = goals.filter(site => site.goal.id === target);
      if (sites.length > 1) add(errors, file, `${path}/target_goal`, `Ambiguous goal target '${target}' has ${sites.length} declarations`);
      else if (sites.length === 1 && targets.length !== 1) add(errors, file, `${path}/target_goal`, `Target '${target}' is not a declared Goal`);
      // Missing references are already emitted by the schema-derived reference walk.
      if (target === goal.id) add(errors, file, `${path}/target_goal`, `Goal '${goal.id}' targets itself`);
      const pair = JSON.stringify([goal.id, target].sort());
      const key = JSON.stringify([claim.kind === 'conflicts_with' ? pair : [goal.id, target], claim.kind, claim.contribution ?? null]);
      if (seen.has(key)) add(warnings, file, path, 'Duplicate goal relation semantic key; every authored occurrence is retained');
      seen.add(key);
      if (claim.certainty === undefined) add(warnings, file, path, 'Goal relation certainty is unstated');
      if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
        add(warnings, file, path, claim.certainty === 'confirmed'
          ? 'Confirmed goal relation has no evidence'
          : 'Goal relation has no evidence');
      }
      claims.push({ source: goal.id, target, pair, claim, file, path });
    });
  }
  for (const entry of claims) {
    const { source, target, pair, claim, file, path } = entry;
    if (claim.kind === 'contributes_to' && claim.contribution === 'hurt'
      && claims.some(other => other.source === source && other.target === target
        && other.claim.kind === 'contributes_to' && other.claim.contribution === 'help')) {
      add(warnings, file, path, 'Both help and hurt are asserted for this directed goal pair; context remains as authored');
    }
    if (claim.kind === 'conflicts_with' && claims.some(other => other.pair === pair && other.claim.kind === 'requires')) {
      add(warnings, file, path, 'Conflict and requirement are asserted on this goal pair');
    }
  }
  return { errors, warnings };
}
