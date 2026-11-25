import { SCHEMA_BASE_URI } from './schema-registry.mjs';

// Explicit document keys read by placeAsWritten.ts; other underscore fields remain schema-checked.
const REPLAY_PLACEMENT_FIELDS = [
  '_written_in', '_context', '_party', '_root', '_scope', '_context_name',
  '_owned_by_default', '_domain_ref_default', '_system_ref_default',
];

// The migration vocabulary routes to definitions in the schema line being validated.
// Aliases name definitions whose file vocabulary differs from the migration vocabulary.
const ENTITY_SCHEMAS = {
  concept: ['design/concepts', 'concept'], actor: ['design/concepts', 'actor'],
  enumeration: ['design/concepts', 'enumeration'], association: ['design/concepts', 'association'],
  operation: ['design/domain', 'operation'], error: ['design/domain', 'error_entry'], question: ['design/domain', 'question'],
  rule: ['design/rules', 'rule'], transition: ['design/rules', 'transition_rule'],
  model: ['design/models', 'model_schema'], process: ['design/story', 'process'],
  'process-activity': ['design/story', 'process_activity'], 'user-story': ['design/story', 'user_story'],
  'use-case': ['design/story', 'use_case'],
  context: ['design/arch', 'context'], service: ['design/arch', 'service'], dependency: ['design/arch', 'dependency'],
  party: ['governance/organization', 'party'], department: ['governance/organization', 'department'], team: ['governance/organization', 'team'],
  goal: ['governance/motivation', 'goal'], 'non-goal': ['governance/motivation', 'non_goal'],
  risk: ['governance/motivation', 'risk'], assumption: ['governance/motivation', 'assumption'],
  'trade-off': ['governance/motivation', 'trade_off'], inquiry: ['governance/motivation', 'inquiry'],
  decision: ['governance/decisions', 'decision'], capability: ['governance/capability', 'capability'],
  'test-case': ['governance/test-cases', 'test_case'], 'fitness-function': ['governance/test-cases', 'fitness_function'],
  metric: ['design/quality', 'metric'], kpi: ['design/quality', 'kpi'], slo: ['design/quality', 'slo'], sla: ['design/quality', 'sla'],
  security: ['design/quality', 'security_requirement'], compliance: ['design/quality', 'compliance_requirement'],
  resilience: ['design/quality', 'resilience_requirement'],
  parallelism: ['design/dynamics', 'parallelism_opportunity'], ordering: ['design/dynamics', 'ordering_constraint'],
  'race-condition': ['design/dynamics', 'race_condition'], screen: ['design/interactions', 'screen'],
  'ui-action': ['design/interactions', 'action'], 'ui-navigation': ['design/interactions', 'navigation'],
  resource: ['design/infrastructure', 'resource'], milestone: ['governance/roadmap', 'milestone'],
  'value-stream': ['governance/value-stream', 'value_stream'], contract: ['design/arch', 'contracts'],
};

/** Check bodies independently of the migration envelope. Historical partial snapshots warn first. */
export function migrationEntityBodyFindings(data, registry, ajv) {
  const findings = [];
  const changes = data?.changes?.entities;
  if (!Array.isArray(changes)) return findings;
  changes.forEach((change, changeIndex) => {
    const entityType = change?.entity_type;
    // The envelope already reports invalid vocabulary. Never coerce an authored object into a key.
    if (typeof entityType !== 'string' || !Object.hasOwn(ENTITY_SCHEMAS, entityType)) return;
    const route = ENTITY_SCHEMAS[entityType];
    let [file, definition] = route;
    // Earlier schema lines use the old layer names.
    if (!registry.has(`${file}.schema.yaml`)) {
      file = file.replace('/organization', '/org').replace('/interactions', '/ui').replace('/infrastructure', '/rg');
    }
    const schema = registry.get(`${file}.schema.yaml`);
    if (!schema?.$defs?.[definition]) return;
    let validate;
    if (change.entity_type === 'contract') {
      const variants = Object.keys(schema.$defs.contracts.properties ?? {})
        .filter(kind => kind !== 'security_schemes')
        .map(kind => ({ $ref: `${SCHEMA_BASE_URI}${file}.schema.yaml#/$defs/contracts/properties/${kind}` }));
      validate = ajv.compile({ anyOf: variants });
    } else {
      validate = ajv.getSchema(`${SCHEMA_BASE_URI}${file}.schema.yaml#/$defs/${definition}`);
    }
    if (!validate) return;
    for (const block of ['before', 'after']) {
      if (change[block] === undefined) continue;
      const bodies = block === 'after' && change.kind === 'split' && Array.isArray(change.after)
        ? change.after : [change[block]];
      bodies.forEach((body, bodyIndex) => {
        // Replay reads these placement fields to put the entity in its file and context; they are not entity fields.
        const checked = body && typeof body === 'object' && !Array.isArray(body) ? { ...body } : body;
        if (checked && typeof checked === 'object') {
          for (const placementField of REPLAY_PLACEMENT_FIELDS) {
            delete checked[placementField];
          }
        }
        if (validate(checked)) return;
        const at = `/changes/entities/${changeIndex}/${block}${bodies === change.after ? `/${bodyIndex}` : ''}`;
        for (const error of validate.errors ?? []) {
          const property = error.params?.additionalProperty ?? error.params?.missingProperty;
          findings.push(`${at}${error.instancePath} -> ${error.message}${property ? `: ${property}` : ''}`);
        }
      });
    }
  });
  return findings;
}
