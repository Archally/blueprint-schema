/**
 * Entity type constants for v2 blueprint model.
 * Aligned with step-01 entity kind list and traceability map.
 */
export const ENTITY_TYPE = {
  Concept: 'Concept',
  Actor: 'Actor',
  Persona: 'Persona',
  Enumeration: 'Enumeration',
  Association: 'Association',
  StructuralRule: 'StructuralRule',
  ClassificationRule: 'ClassificationRule',
  DerivationRule: 'DerivationRule',
  EquivalenceRule: 'EquivalenceRule',
  ValidationRule: 'ValidationRule',
  TransitionRule: 'TransitionRule',
  Operation: 'Operation',
  Context: 'Context',
  Service: 'Service',
  Contract: 'Contract',
  Goal: 'Goal',
  NonGoal: 'NonGoal',
  Risk: 'Risk',
  Assumption: 'Assumption',
  TradeOff: 'TradeOff',
  Inquiry: 'Inquiry',
  Concern: 'Concern',
  // v2.7.7 vision CR (D045): the product's singular identity claim / north-star — a
  // first-class governance entity distinct from Goal (measurable) and the root description
  // (a blurb). Extracted from the singular `motivation.vision` object (at most one per model);
  // forward-links to the goals/capabilities/value-streams that operationalize it.
  Vision: 'Vision',
  Decision: 'Decision',
  BusinessDecision: 'BusinessDecision',
  TestCase: 'TestCase',
  Capability: 'Capability',
  Metric: 'Metric',
  KPI: 'KPI',
  SLO: 'SLO',
  SLA: 'SLA',
  Security: 'Security',
  Compliance: 'Compliance',
  Resilience: 'Resilience',
  Finding: 'Finding',
  Process: 'Process',
  Dynamics: 'Dynamics',
  Models: 'Models',
  RG: 'RG',
  DeploymentTier: 'DeploymentTier',
  // v2.7.7 infrastructure layer (CR-1/CR-2). InfraResource (IR###) supersedes RG for
  // v2.7 `infrastructure.yaml`; RG stays for v2.6 `rg.yaml` back-compat.
  InfraResource: 'InfraResource',
  Environment: 'Environment',
  Binding: 'Binding',
  ResourceType: 'ResourceType',
  // v2.7.7 DeploymentScope CR: substrate-neutral management/lifecycle partition (DSC###) —
  // Azure RG/subscription, AWS account/OU, GCP project/folder, k8s cluster/namespace, on-prem
  // datacenter/host-pool. Nests via `parent`; resources join via `scope_ref`. Under
  // `design.infrastructure` (from `deployment_scopes[]` in infrastructure.yaml).
  DeploymentScope: 'DeploymentScope',
  Party: 'Party',
  Department: 'Department',
  Team: 'Team',
  Screen: 'Screen',
  UIAction: 'UIAction',
  UINavigation: 'UINavigation',
  Question: 'Question',
  Error: 'Error',
  UserStory: 'UserStory',
  UseCase: 'UseCase',
  Milestone: 'Milestone',
  WorkItem: 'WorkItem',
  ValueStream: 'ValueStream',
  LeveragePoint: 'LeveragePoint',
  CodeFile: 'CodeFile',
  Missing: 'Missing',
  // v2.8.6 problem-space registry (blueprint.yaml root `domains:`). Domain (DMN###) and, nested
  // under it, Subdomain (SDM###) - exactly two levels, a subdomain declares no subdomains of its
  // own. Distinct from the DDD tactical `domain.yaml` plane (design.domain layer), which models
  // aggregates/entities/events inside a bounded context rather than the strategic problem space.
  Domain: 'Domain',
  Subdomain: 'Subdomain',
  // Where the model has been, from either document that records it: the reader-facing
  // register (`migrations.yaml`) and the executable change program (`*.migration.yaml`).
  // One type for both, with `_genre` on the node saying which - the reader-facing facts are
  // the same facts, and the two `status` vocabularies are not, which is what `_genre` is for.
  Migration: 'Migration',
} as const;

export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

/** Schema type (filename) to layer id (plane.layer). */
export const SCHEMA_TYPE_TO_LAYER: Record<string, string> = {
  concepts: 'design.concepts',
  rules: 'design.rules',
  domain: 'design.domain',
  arch: 'design.arch',
  models: 'design.models',
  // `story` is the file kind's name before v2.8.10 and `process` its name now. Both resolve to
  // the same layer: the vocabulary is the code's, and a model on an earlier schema line describes
  // the same thing under the older word.
  story: 'design.process',
  process: 'design.process',
  dynamics: 'design.dynamics',
  quality: 'design.quality',
  rg: 'design.rg',
  // v2.7.7: `infrastructure` has its own layer id (in v2.6 it was aliased to
  // `design.rg`). `rg` stays `design.rg` for v2.6 back-compat.
  infrastructure: 'design.infrastructure',
  motivation: 'governance.motivation',
  capability: 'governance.capability',
  decisions: 'governance.decisions',
  'test-cases': 'governance.tests',
  org: 'governance.org',
  organization: 'governance.org',
  ui: 'design.ui',
  interactions: 'design.ui',
  roadmap: 'governance.roadmap',
  'value-stream': 'governance.value-stream',
  leverage: 'governance.leverage',
  blueprint: 'blueprint',
  // A migration sits outside both planes. Its layer is its own, and because both adapters
  // derive a plane from the layer prefix and accept only `design` and `governance`, this one
  // yields no plane without either of them learning what a migration is.
  migration: 'migrations',
  migrations: 'migrations',
};
