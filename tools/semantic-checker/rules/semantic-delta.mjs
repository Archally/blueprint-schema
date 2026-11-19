// @ts-check
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadRules, loadExtensions, runChecker } from '@archally/semantic-checker';
/** The model fields the comparison reads: entity identity and the file each entity came from.
 * @typedef {{entities: Array<{id: string, displayId: string, fileOrigin?: string, data?: Record<string, unknown>}>}} Model */
/** What the host process supplies: how it reads the lint config and turns a built model into the
 * checker's input. The CLI and the MCP server pass their shared implementations; this package stays
 * free of a CLI dependency so viewers that read the rule pack do not pull one in.
 * @typedef {{
 *   readLintConfig: (specDir: string) => {path: string | null, config: any},
 *   readLintConfigFile: (path: string) => any,
 *   toCheckableModel: (model: any) => any,
 * }} SemanticHost */
/** @typedef {import('@archally/semantic-checker').SemanticIssue} Issue */
/** @typedef {{status:'placed'|'ambiguous'|'unresolved'|'model',entity_id:string|null,candidates:string[]}} Subject */
/** @typedef {{rule_id:string,severity:Issue['severity'],subject:Subject,count:number,messages:string[],transition_key:string}} FindingGroup */
/** @typedef {{rule_id:string,severity:Issue['severity'],subject:Subject,before_messages:string[],after_messages:string[],evidence_attribution:'unavailable'}} DetailGroup */
/** @template T @typedef {{total:number,groups:number,returned:number,truncated:boolean,rows:T[]}} Section */
/** @param {unknown} value */
export function semanticDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
/** @param {string} directory */
export function semanticPackIdentity(directory) {
  /** @param {string} relative @returns {Array<[string,string]>} */
  function records(relative) {
    return readdirSync(join(directory, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) return ['node_modules', 'types'].includes(entry.name) ? [] : records(path);
      return /\.(?:ya?ml|m?js|json)$/.test(entry.name) && !entry.name.includes('.test.') ? [[path, readFileSync(join(directory, path), 'utf8')]] : [];
    });
  }
  return semanticDigest(records(''));
}
const ruleDirectory = dirname(createRequire(import.meta.url).resolve('@archally/blueprint-semantic-rules/package.json'));
/** @type {Map<string,string>} */
const loadedIdentities = new Map();
/** One immutable checker/config snapshot shared by both checks; extension changes require restart.
 * @param {string} specDir @param {SemanticHost} host @param {string} [rulesDirectory] @param {string} [explicitConfigPath] */
export async function loadSemanticEnvironment(specDir, host, rulesDirectory = ruleDirectory, explicitConfigPath) {
  const identity = semanticPackIdentity(rulesDirectory);
  const previousIdentity = loadedIdentities.get(rulesDirectory);
  if (previousIdentity && previousIdentity !== identity) throw new Error('Semantic rule pack changed; restart the process to reload extensions.');
  const rules = await loadRules(rulesDirectory);
  if (rules.length === 0) throw new Error('Semantic rule pack is empty.');
  const extensions = await loadExtensions(rules);
  if (semanticPackIdentity(rulesDirectory) !== identity) throw new Error('Semantic rules changed while loading; restart the process.');
  loadedIdentities.set(rulesDirectory, identity);
  const config = explicitConfigPath ? { path: resolve(explicitConfigPath), config: host.readLintConfigFile(resolve(explicitConfigPath)) } : host.readLintConfig(specDir);
  const configIdentity = semanticDigest({ path: config.path, bytes: config.path ? readFileSync(config.path, 'utf8') : null, config: config.config });
  return { identity, configIdentity, config, rules, extensions, toCheckableModel: host.toCheckableModel };
}
/** @param {Model['entities'][number]} entity */
function authoredId(entity) {
  const written = entity.data?.id;
  if (typeof written !== 'string') return entity.displayId;
  if (entity.displayId.endsWith(`.${written}`)) return entity.displayId;
  return written;
}
/** Request-local alias indexes, never internal ids as comparison identity. @param {Model} model */
function subjectResolver(model) {
  /** @type {Map<string,Array<Model['entities'][number]>>} */
  const aliases = new Map();
  /** @type {Map<string,number>} */
  const declarations = new Map();
  for (const entity of model.entities) {
    const canonical = authoredId(entity);
    declarations.set(canonical, (declarations.get(canonical) ?? 0) + 1);
    for (const alias of new Set([entity.id, entity.displayId, canonical, canonical.split('.').at(-1)])) {
      if (!alias) continue;
      const entities = aliases.get(alias) ?? [];
      entities.push(entity);
      aliases.set(alias, entities);
    }
  }
  /** @param {Issue} issue @returns {Subject} */
  return issue => {
    if (!issue.entityId) return { status: 'model', entity_id: null, candidates: [] };
    let matches = aliases.get(issue.entityId) ?? [];
    if (matches.length > 1 && issue.file) {
      const sameFile = matches.filter(entity => entity.fileOrigin?.replace(/\\/g, '/') === issue.file?.replace(/\\/g, '/'));
      if (sameFile.length > 0) matches = sameFile;
    }
    const candidates = [...new Set(matches.map(authoredId))].sort();
    const ambiguous = matches.length > 1 || candidates.some(identifier => (declarations.get(identifier) ?? 0) > 1);
    const placed = matches.length === 1 && !ambiguous;
    return { status: placed ? 'placed' : ambiguous ? 'ambiguous' : 'unresolved', entity_id: placed ? candidates[0] : null, candidates };
  };
}
/** @param {Model} model @param {Issue[]} issues */
function groupIssues(model, issues) {
  const subjectOf = subjectResolver(model);
  /** @type {Map<string,FindingGroup>} */
  const groups = new Map();
  for (const issue of issues) {
    const subject = subjectOf(issue);
    const transition_key = JSON.stringify([issue.ruleId, subject]);
    const key = JSON.stringify([transition_key, issue.severity]);
    const group = groups.get(key) ?? { rule_id: issue.ruleId, severity: issue.severity, subject, count: 0, messages: [], transition_key };
    group.count++;
    group.messages.push(issue.message);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.messages.sort();
  return groups;
}
/** @template T @param {T[]} rows @param {(row:T)=>number} count @returns {Section<T>} */
function section(rows, count) {
  return { total: rows.reduce((total, row) => total + count(row), 0), groups: rows.length, returned: rows.length, truncated: false, rows };
}
/** Compare multisets, preserving diagnostic payload without using prose as identity.
 * @param {Model} before @param {Model} after @param {Issue[]} beforeIssues @param {Issue[]} afterIssues */
export function diffSemanticIssues(before, after, beforeIssues, afterIssues) {
  const baseline = groupIssues(before, beforeIssues);
  const candidate = groupIssues(after, afterIssues);
  /** @type {FindingGroup[]} */
  const introduced = [];
  /** @type {FindingGroup[]} */
  const resolved = [];
  /** @type {DetailGroup[]} */
  const details = [];
  const counts = { error: 0, warn: 0, info: 0 };
  for (const key of [...new Set([...baseline.keys(), ...candidate.keys()])].sort()) {
    const previous = baseline.get(key);
    const next = candidate.get(key);
    const difference = (next?.count ?? 0) - (previous?.count ?? 0);
    if (difference > 0 && next) {
      introduced.push({ ...next, count: difference });
      counts[next.severity] += difference;
    }
    if (difference < 0 && previous) resolved.push({ ...previous, count: -difference });
    if (difference === 0 && previous && next && JSON.stringify(previous.messages) !== JSON.stringify(next.messages)) {
      details.push({ rule_id: next.rule_id, subject: next.subject, severity: next.severity, before_messages: previous.messages, after_messages: next.messages, evidence_attribution: 'unavailable' });
    }
  }
  return { introduced: section(introduced, row => row.count), resolved: section(resolved, row => row.count), details_changed: section(details, () => 1), counts };
}
/** @param {Model} before @param {Model} after @param {Awaited<ReturnType<typeof loadSemanticEnvironment>>} environment @param {typeof runChecker} [checker] */
export function semanticComparison(before, after, environment, checker = runChecker) {
  const started = performance.now();
  const beforeIssues = checker(environment.toCheckableModel(before), environment.rules, environment.config.config, environment.extensions);
  const firstCheck = performance.now();
  const afterIssues = checker(environment.toCheckableModel(after), environment.rules, environment.config.config, environment.extensions);
  const secondCheck = performance.now();
  const delta = diffSemanticIssues(before, after, beforeIssues, afterIssues);
  return { ...delta, identities: { rules: environment.identity, config: environment.configIdentity }, instrumentation: { checker_calls: 2, baseline_check_ms: firstCheck - started, candidate_check_ms: secondCheck - firstCheck, diff_ms: performance.now() - secondCheck } };
}
/** Page groups only after totals/gates are complete. @template {ReturnType<typeof diffSemanticIssues>} T @param {T} delta @param {number} [limit] @param {number} [offset] */
export function pageSemanticDelta(delta, limit = 20, offset = 0) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) throw new Error('Semantic paging needs a positive integer limit and nonnegative integer offset.');
  /** @template R @param {Section<R>} value @returns {Section<R>} */
  function page(value) {
    const rows = value.rows.slice(offset, offset + limit);
    return { ...value, returned: rows.length, truncated: offset + rows.length < value.groups, rows };
  }
  return { ...delta, introduced: page(delta.introduced), resolved: page(delta.resolved), details_changed: page(delta.details_changed) };
}
