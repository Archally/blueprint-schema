import configuration from './model-text-paragraphs.config.json' with { type: 'json' };
import { detectSchemaType } from './schema-types.mjs';
import { classifyModelFiles } from './file-membership.mjs';

export const MODEL_TEXT_RULE = 'model-text-paragraphs';

// Only entity containers are walked. Payloads, properties, provenance and document metadata
// never become subjects merely because they contain a narrative key.
const collections = {
  blueprint: ['domains', 'products'],
  concepts: ['concepts', 'actors', 'enumerations', 'associations'],
  domain: ['questions'],
  rules: ['structural', 'classification', 'derivation', 'equivalence', 'validation', 'transition'],
  motivation: ['goals', 'non_goals', 'risks', 'assumptions', 'trade_offs', 'inquiries', 'concerns'],
  decisions: ['decisions', 'business_decisions'],
  'test-cases': ['fitness_functions', 'happy_path', 'edge_cases', 'error_cases'],
  capability: ['capabilities'],
  quality: ['metrics', 'kpis', 'slos', 'slas', 'security', 'compliance', 'resilience', 'findings'],
  story: ['user_stories', 'use_cases'],
  dynamics: ['parallelism', 'ordering', 'race_conditions'],
  ui: ['screens', 'actions', 'navigation'],
  interactions: ['screens', 'actions', 'navigation'],
  roadmap: ['milestones', 'work_items'],
  'value-stream': ['value_streams'],
  leverage: ['leverage_points'],
  infrastructure: ['resources', 'environments', 'deployment_scopes', 'bindings'],
  rg: ['resources'],
  arch: ['probes', 'channels', 'packages'],
  migration: ['migrations'],
  migrations: ['migrations'],
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Map parsed documents to authored entity locations. Each subject carries its original fields;
 * projected summaries and derived copies are not extra authored fields.
 */
export function modelTextSubjects(documents) {
  const subjects = [];
  const seen = new Set();
  const membership = new Set(classifyModelFiles(documents.map(document => document.relFile)).modelFiles);
  for (const { relFile, data } of documents) {
    if (!membership.has(relFile) || !record(data)) continue;
    const type = detectSchemaType(relFile);
    const add = (item, path, identity = item?.id, fields) => {
      if (!record(item) || identity == null) return false;
      const key = JSON.stringify([relFile, path]);
      if (!seen.has(key)) {
        seen.add(key);
        subjects.push({ file: relFile, path, entityId: String(identity),
          name: String(item.name ?? item.term ?? item.title ?? identity), data: item, fields });
      }
      return true;
    };
    const list = (items, path, visit) => {
      if (Array.isArray(items)) items.forEach((item, index) => {
        if (record(item)) visit(item, `${path}[${index}]`, index);
      });
    };
    const tree = (items, path, depth = 0) => {
      if (depth > 10) return;
      list(items, path, (item, itemPath) => {
        if (add(item, itemPath)) tree(item.children, `${itemPath}.children`, depth + 1);
      });
    };
    for (const key of collections[type] ?? []) {
      if ((type === 'capability' && key === 'capabilities') || (type === 'roadmap' && key === 'work_items')) {
        tree(data[key], key);
      } else {
        list(data[key], key, (item, path) => {
          if (add(item, path) && type === 'blueprint' && key === 'domains') {
            list(item.subdomains, `${path}.subdomains`, (child, childPath) => add(child, childPath));
          }
        });
      }
    }
    if (type === 'domain') {
      for (const key of ['operations', 'errors']) {
        if (Array.isArray(data[key])) {
          list(data[key], key, (item, path, index) => add(item, path, item.id ?? `OP${String(index + 1).padStart(3, '0')}`));
        } else if (record(data[key])) {
          for (const [name, item] of Object.entries(data[key])) add(item, `${key}[${JSON.stringify(name)}]`, item?.id ?? name);
        }
      }
    }
    if (type === 'motivation') add(data.vision, 'vision', 'vision');
    if (type === 'story') {
      const key = data.processes != null ? 'processes' : 'stories';
      list(data[key], key, (item, path, index) => add(item, path,
        item.id ?? item.storyId ?? item.title ?? `story-${index + 1}`, ['description']));
    }
    if (type === 'models') {
      for (const section of ['schemas', 'x-field', 'x-parameter']) {
        const items = data.components?.[section];
        if (record(items)) for (const [name, item] of Object.entries(items)) {
          add(item, `components.${section}[${JSON.stringify(name)}]`, item?.['x-model-id'] ?? name);
        }
      }
    }
    if (type === 'migration' || type === 'migrations') add(data.migration, 'migration');
    if (type === 'rg' || type === 'infrastructure') {
      list(data.topology?.tiers, 'topology.tiers', (item, path) => { if (item.name) add(item, path, item.name); });
    }
    if (type === 'org' || type === 'organization') {
      list(data.parties, 'parties', (party, partyPath) => {
        if (!party.id || !add(party, partyPath)) return;
        for (const key of ['departments', 'teams']) list(party[key], `${partyPath}.${key}`, (item, path) => {
          if (item.id) add(item, path);
        });
      });
    }
    if (type === 'arch') {
      const context = (item, path) => {
        if (!item.name || !add(item, path, item.name)) return;
        list(item.services, `${path}.services`, (service, servicePath) => {
          if (!service.name || !add(service, servicePath, service.name)) return;
          if (record(service.contracts)) for (const [name, contract] of Object.entries(service.contracts)) {
            add(contract, `${servicePath}.contracts[${JSON.stringify(name)}]`, `${service.name}.${name}`);
          }
        });
      };
      list(data.parties, 'parties', (party, path) => {
        if (party.name && add(party, path, party.id || party.name)) list(party.contexts, `${path}.contexts`, context);
      });
      list(data.contexts, 'contexts', context);
    }
  }
  return subjects;
}

/** One finding per configured string field of an authored entity. Length uses UTF-16 code units. */
export function modelTextFindings(documents, settings = configuration) {
  const findings = [];
  for (const subject of modelTextSubjects(documents)) {
    for (const field of settings.narrativeFields) {
      if (subject.fields && !subject.fields.includes(field)) continue;
      const value = subject.data[field];
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (text.length <= settings.maximumUnstructuredCharacters || hasAuthoredStructure(text)) continue;
      findings.push({ file: subject.file, entityId: subject.entityId, name: subject.name,
        field, path: `${subject.path}.${field}`, length: text.length,
        threshold: settings.maximumUnstructuredCharacters });
    }
  }
  return findings;
}

/** The same located, actionable sentence on every validation surface. */
export function modelTextMessage(finding) {
  return `[${MODEL_TEXT_RULE}] [${finding.file}] ${finding.entityId} (${finding.name}) at ${finding.path} has `
    + `${finding.length} characters without paragraph or list structure (threshold ${finding.threshold}). `
    + 'Preserve wording and meaning; consider blank-line paragraphs or a genuine markdown list in a YAML literal block.';
}

/** Blank lines delimit paragraphs; a terminal newline and ordinary wrapping do not. */
function hasAuthoredStructure(text) {
  const proseLines = [];
  let fenceMarker;
  let fenceLength = 0;
  for (const line of text.split(/\r?\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMarker !== undefined) {
      if (fence?.[1][0] === fenceMarker) {
        if (fence[1].length >= fenceLength) {
          fenceMarker = undefined;
        }
      }
      continue;
    }
    if (fence !== null) {
      fenceMarker = fence[1][0];
      fenceLength = fence[1].length;
      continue;
    }
    if (/^ {0,3}([-*_])(?:[\t ]*\1){2,}[\t ]*$/.test(line)) {
      proseLines.push(line);
      continue;
    }
    if (/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+\S/.test(line)) {
      return true;
    }
    proseLines.push(line);
  }
  return /\n[\t ]*\n/.test(proseLines.join('\n').trim());
}
