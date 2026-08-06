// @ts-check
/**
 * Blueprint YAML → observations.
 *
 * The collector knows blueprint shapes; the spec knows what to do about them.
 * That seam is deliberate: adding a threshold, a content rule or a deferral is a
 * YAML edit, while teaching the tool a NEW shape is a code change.
 *
 * One observation = one thing that could have been self-described.
 * Aggregation, scoring and thresholds all happen downstream in evaluate.mjs, so a
 * single pass feeds the human report, the strict gate AND the per-item worklist
 * that the remediation dossier (plan step-10) is generated from.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { sliceOf } from './slice.mjs';

/** Generated/derived trees are reported on but never authored — skip them entirely. */
const EXCLUDE_DIRS = new Set([
  '.handoffs', '.audit', '.views', '.specs', 'plan-log', '_artifacts',
  'node_modules', '.git', '.quality', '.migrations',
]);

const TYPED_ID_RE = /^(?:[a-z0-9-]+\.)+?([A-Z]{1,4})\d{2,5}$|^([A-Z]{1,4})\d{2,5}$/;

/** Business rules are filed by rule kind — there is no single `rules:` container. */
const RULE_CATEGORIES = ['structural', 'classification', 'derivation', 'equivalence', 'validation', 'transition'];

/** Test cases are filed by scenario class — there is no single `tests:` container. */
const TEST_CASE_CATEGORIES = ['happy_path', 'edge_cases', 'error_cases', 'fitness_functions'];

/**
 * @typedef {object} Observation
 * @property {string} metric      metric id, e.g. `model.property.description`
 * @property {string} file        absolute path of the source file
 * @property {string} [slice]     architectural slice (first path segment under the model root)
 * @property {string} [entityId]  typed id when the subject has one
 * @property {string} subject     human locator, e.g. `JustifyPayGapPayload.criteria`
 * @property {unknown} value      the collected value (undefined when absent)
 * @property {Record<string,string>} [context] echo-detection context (`name`, `title`)
 */

/** Tooling config that lives beside the model but is not part of it. */
const EXCLUDE_FILES = new Set(['.blueprint-quality.yaml', '.blueprint-lint.yaml']);

/** @param {string} dir */
function* walkYamlFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      yield* walkYamlFiles(path.join(dir, entry.name));
    } else if ((entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) && !EXCLUDE_FILES.has(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

/** @param {unknown} id */
function typedIdOf(id) {
  if (typeof id !== 'string') return undefined;
  return TYPED_ID_RE.test(id) ? id : undefined;
}

/**
 * Blueprint collections are authored either as arrays or as name-keyed maps
 * (both are valid, and large brownfield models lean on the map form). Normalize to entries so
 * the map key can still serve as the subject name.
 * @param {unknown} collection
 * @returns {Array<[string|undefined, Record<string, any>]>}
 */
function entriesOf(collection) {
  if (Array.isArray(collection)) {
    return collection
      .filter((value) => value && typeof value === 'object')
      .map((value) => [undefined, value]);
  }
  if (collection && typeof collection === 'object') {
    return Object.entries(collection)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([key, value]) => [key, value]);
  }
  return [];
}

/**
 * Compare dotted version strings numerically (`2.7.7` > `2.6.0` > `2.10` is false).
 * @param {string} left @param {string} right
 */
function compareVersions(left, right) {
  const leftParts = String(left).split('.').map(Number);
  const rightParts = String(right).split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** @param {Record<string,any>} entity @param {string|undefined} key */
function nameOf(entity, key) {
  return entity.name ?? entity.term ?? entity.title ?? key ?? entity.id ?? '(unnamed)';
}

/**
 * Several entity types legitimately carry their prose under a different key —
 * some models document actors with `summary` and are 100% covered that way, so treating `description`
 * as the only carrier would manufacture false positives (plan D11).
 * @param {Record<string,any>} entity
 */
function proseOf(entity) {
  return entity.description ?? entity.statement ?? entity.summary;
}

class ObservationCollector {
  constructor() {
    /** @type {Observation[]} */
    this.observations = [];
    /** @type {string[]} */
    this.parseErrors = [];
    this.fileCount = 0;
    /** @type {string|undefined} */
    this.schemaVersion = undefined;
    /** Entities a specific collector already measured — the generic sweep skips these. */
    this.claimed = new Set();
  }

  /**
   * @param {string} metric
   * @param {string} file
   * @param {string} subject
   * @param {unknown} value
   * @param {{entityId?: string, context?: Record<string,string>}} [extra]
   */
  add(metric, file, subject, value, extra = {}) {
    this.observations.push({ metric, file, subject, value, ...extra });
  }

  /** @template T @param {T} entity @returns {T} */
  claim(entity) {
    this.claimed.add(entity);
    return entity;
  }

  /** @param {string} file @param {any} doc */
  collectFile(file, doc) {
    // A model is a set of files; take the HIGHEST declared version rather than the
    // first one walked, so one stale file cannot mislabel the whole model.
    if (typeof doc?.schemaVersion === 'string') {
      if (!this.schemaVersion || compareVersions(doc.schemaVersion, this.schemaVersion) > 0) {
        this.schemaVersion = doc.schemaVersion;
      }
    }
    this.collectModels(file, doc);
    this.collectDomain(file, doc);
    this.collectConcepts(file, doc);
    this.collectRules(file, doc);
    this.collectStory(file, doc);
    this.collectTests(file, doc);
    this.collectGovernance(file, doc);
    this.collectUnclaimedEntities(file, doc);
  }

  // ── design plane ───────────────────────────────────────────────────────────

  /** @param {string} file @param {any} doc */
  collectModels(file, doc) {
    for (const [schemaName, schema] of entriesOf(doc?.components?.schemas)) {
      this.claim(schema);
      const title = schemaName ?? schema['x-model-id'] ?? '(schema)';
      const entityId = typedIdOf(schema['x-model-id']);
      const context = { name: String(title), title: String(title) };

      this.add('model.schema.description', file, String(title), schema.description, { entityId, context });
      this.add('model.schema.purpose', file, String(title), schema.purpose, { entityId, context });
      this.add('model.schema.represents', file, String(title), schema.represents, { entityId, context });

      this.collectProperties(file, String(title), schema, entityId);
    }
  }

  /**
   * Walk a JSON-Schema-shaped node, emitting one observation per authored property.
   * Pure `$ref` properties are skipped — they inherit their description from the
   * referenced definition, so counting them would penalize correct reuse.
   * @param {string} file
   * @param {string} schemaTitle
   * @param {any} node
   * @param {string|undefined} entityId
   * @param {string} [propertyPath]
   * @param {Set<object>} [seen]
   */
  collectProperties(file, schemaTitle, node, entityId, propertyPath = '', seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (node.properties && typeof node.properties === 'object') {
      for (const [propertyName, property] of Object.entries(node.properties)) {
        if (!property || typeof property !== 'object') continue;
        const fullPath = propertyPath ? `${propertyPath}.${propertyName}` : propertyName;
        const subject = `${schemaTitle}.${fullPath}`;
        const isPureRef = property.$ref && Object.keys(property).length <= 2;

        if (!isPureRef) {
          const context = { name: propertyName, title: schemaTitle };
          this.add('model.property.description', file, subject, property.description, { entityId, context });
          this.add('model.property.example', file, subject, property.example ?? property.examples, { entityId, context });
          if (Array.isArray(property.enum)) {
            this.add('model.enum_property.description', file, subject, property.description, { entityId, context });
          }
        }
        this.collectProperties(file, schemaTitle, property, entityId, fullPath, seen);
      }
    }
    if (node.items) this.collectProperties(file, schemaTitle, node.items, entityId, `${propertyPath}[]`, seen);
    for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
      if (Array.isArray(node[combinator])) {
        for (const branch of node[combinator]) {
          this.collectProperties(file, schemaTitle, branch, entityId, propertyPath, seen);
        }
      }
    }
  }

  /** @param {string} file @param {any} doc */
  collectDomain(file, doc) {
    for (const [key, operation] of entriesOf(doc?.operations)) {
      this.claim(operation);
      const entityId = typedIdOf(operation.id);
      if (!operation.kind && !entityId) continue;
      const name = String(nameOf(operation, key));
      const context = { name, title: name };
      const kind = operation.kind
        ?? ({ C: 'command', E: 'event', Q: 'query', D: 'document' })[String(operation.id ?? '')[0]]
        ?? '';

      this.add('domain.operation.description', file, name, proseOf(operation), { entityId, context });

      if (kind === 'command') {
        this.add('domain.command.produces', file, name, operation.produces, { entityId, context });
        this.add('domain.command.exchange', file, name, operation.exchange ?? operation.dispatch, { entityId, context });
      } else if (kind === 'event') {
        // The observed failure shape: `one_of` pairs where only the happy-path half was
        // described and the failure counterpart was left bare.
        this.add('domain.event.description', file, name, proseOf(operation), { entityId, context });
      }
    }
    for (const [key, error] of entriesOf(doc?.errors)) {
      this.claim(error);
      const name = String(nameOf(error, key));
      this.add('domain.error.description', file, name, proseOf(error), {
        entityId: typedIdOf(error.id), context: { name, title: name },
      });
    }
  }

  /** @param {string} file @param {any} doc */
  collectConcepts(file, doc) {
    for (const [key, concept] of entriesOf(doc?.concepts)) {
      this.claim(concept);
      const name = String(nameOf(concept, key));
      const entityId = typedIdOf(concept.id);
      this.add('concept.description', file, name, proseOf(concept), { entityId, context: { name, title: name } });

      for (const [attributeName, attribute] of entriesOf(concept.attributes)) {
        const attrName = String(attributeName ?? nameOf(attribute, undefined));
        const subject = `${name}.${attrName}`;
        const context = { name: attrName, title: name };
        this.add('concept.attribute.description', file, subject, attribute.description, { entityId, context });
        this.add('concept.attribute.example', file, subject, attribute.example ?? attribute.examples, { entityId, context });
      }
    }
    for (const [key, actor] of entriesOf(doc?.actors)) {
      this.claim(actor);
      const name = String(nameOf(actor, key));
      this.add('concept.actor.description', file, name, proseOf(actor), {
        entityId: typedIdOf(actor.id), context: { name, title: name },
      });
    }
    for (const [key, enumeration] of entriesOf(doc?.enumerations)) {
      this.claim(enumeration);
      const enumName = String(nameOf(enumeration, key));
      for (const value of Array.isArray(enumeration.values) ? enumeration.values : []) {
        if (!value || typeof value !== 'object') continue;
        const valueName = String(value.value ?? value.name ?? '(value)');
        this.add('concept.enum_value.description', file, `${enumName}.${valueName}`, value.description, {
          entityId: typedIdOf(enumeration.id), context: { name: valueName, title: enumName },
        });
      }
    }
  }

  /** @param {string} file @param {any} doc */
  collectRules(file, doc) {
    // Rules are filed by rule KIND, not under a single `rules:` key.
    for (const kind of RULE_CATEGORIES) {
      for (const [key, rule] of entriesOf(doc?.[kind])) {
        this.claim(rule);
        const name = String(nameOf(rule, key));
        this.add('rule.description', file, name, proseOf(rule), {
          entityId: typedIdOf(rule.id), context: { name, title: name },
        });
      }
    }
  }

  /** @param {string} file @param {any} doc */
  collectStory(file, doc) {
    for (const [key, userStory] of entriesOf(doc?.user_stories)) {
      this.claim(userStory);
      const name = String(nameOf(userStory, key));
      this.add('user_story.acceptance_criteria', file, name, userStory.acceptance_criteria, {
        entityId: typedIdOf(userStory.id), context: { name, title: name },
      });
    }
    for (const collection of [doc?.stories, doc?.use_cases]) {
      for (const [key, story] of entriesOf(collection)) {
        this.claim(story);
        const name = String(nameOf(story, key));
        this.add('story.description', file, name, proseOf(story), {
          entityId: typedIdOf(story.id), context: { name, title: name },
        });
      }
    }
  }

  /** @param {string} file @param {any} doc */
  collectTests(file, doc) {
    // Test cases are filed by SCENARIO CLASS (`happy_path`, `edge_cases`, …); there
    // is no single `tests:` key. Missing these was how the first pass silently
    // reported zero test coverage on a model with hundreds of test cases.
    for (const scenarioClass of TEST_CASE_CATEGORIES) {
      for (const [key, testCase] of entriesOf(doc?.[scenarioClass])) {
        this.claim(testCase);
        const name = String(nameOf(testCase, key));
        const entityId = typedIdOf(testCase.id);
        const context = { name, title: name };
        this.add('test_case.description', file, name, proseOf(testCase), { entityId, context });
        this.add('test_case.provenance', file, name, testCase.provenance, { entityId, context });
      }
    }
  }

  /**
   * Safety net: any typed-id entity no specific collector claimed still gets its
   * description measured. Without this, a schema addition (a new entity kind, a
   * renamed container key) silently drops out of the gate and reads as "clean" —
   * the exact failure mode this tool exists to prevent, reproduced one level up.
   * @param {string} file
   * @param {any} node
   * @param {Set<object>} seen
   */
  collectUnclaimedEntities(file, node, seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) this.collectUnclaimedEntities(file, item, seen);
      return;
    }
    const entityId = typedIdOf(node.id);
    if (entityId && !this.claimed.has(node)) {
      const name = String(nameOf(node, undefined));
      this.add('entity.description', file, `${entityId} ${name}`, proseOf(node), {
        entityId, context: { name, title: name },
      });
    }
    for (const value of Object.values(node)) this.collectUnclaimedEntities(file, value, seen);
  }

  /** @param {string} file @param {any} doc */
  collectGovernance(file, doc) {
    for (const [key, decision] of entriesOf(doc?.decisions)) {
      this.claim(decision);
      const name = String(nameOf(decision, key));
      const entityId = typedIdOf(decision.id);
      const context = { name, title: name };
      this.add('decision.description', file, name, proseOf(decision), { entityId, context });

      // A decision claiming settled status while citing nothing is an epistemic
      // defect, not a coverage gap — so it is only observed where the claim is made.
      const isAsserted = decision.certainty === 'confirmed'
        || decision.discovery_stage === 'validated'
        || decision.discovery_stage === 'committed';
      if (isAsserted) {
        this.add('decision.evidence_when_asserted', file, name, decision.evidence, { entityId, context });
      }
    }
    for (const [key, risk] of entriesOf(doc?.risks)) {
      this.claim(risk);
      const name = String(nameOf(risk, key));
      this.add('risk.mitigation', file, name, risk.mitigation ?? risk.contingency, {
        entityId: typedIdOf(risk.id), context: { name, title: name },
      });
    }
  }
}

/**
 * Scan one model root.
 * @param {string} modelRoot
 * @returns {{observations: Observation[], parseErrors: string[], fileCount: number, schemaVersion?: string}}
 */
export function collectObservations(modelRoot) {
  const collector = new ObservationCollector();
  for (const file of walkYamlFiles(modelRoot)) {
    collector.fileCount++;
    let doc;
    try {
      doc = YAML.parse(fs.readFileSync(file, 'utf8'), { maxAliasCount: -1 });
    } catch (error) {
      collector.parseErrors.push(`${path.relative(modelRoot, file)}: ${String(error.message).split('\n')[0]}`);
      continue;
    }
    if (doc && typeof doc === 'object') collector.collectFile(file, doc);
  }
  // Stamp each observation with the slice its file belongs to, so evaluate.mjs can
  // scope a run to one slice without re-deriving paths.
  const resolvedRoot = path.resolve(modelRoot);
  for (const observation of collector.observations) {
    observation.slice = sliceOf(resolvedRoot, observation.file);
  }
  return {
    observations: collector.observations,
    parseErrors: collector.parseErrors,
    fileCount: collector.fileCount,
    schemaVersion: collector.schemaVersion,
  };
}
