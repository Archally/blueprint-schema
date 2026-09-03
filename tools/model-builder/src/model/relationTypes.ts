/**
 * Relation type constants for v2 blueprint model.
 * Maps to relationship field names in v2 schemas.
 */
export const RELATION_TYPE = {
  // concepts.schema: owned relationships from concept to concept (concept.relationships[])
  Relationship: 'relationship',
  // concepts.schema: concept lifecycle transition rule references (concept.transition_rules[])
  TransitionRules: 'transition_rules',
  // concepts.schema: actor interactions with concepts or operations (actor.interactions[])
  Interaction: 'interaction',
  // concepts.schema: named cross-concept association (association.subject → association.object)
  Association: 'association',
  // rules.schema: rule references to concepts it constrains (rule.concepts[])
  Concepts: 'concepts',
  // rules.schema: transition rule references to its owning concept (transition_rule.concept)
  Concept: 'concept',
  // domain.schema: operation governed by rules (operation.governed_by[])
  GovernedBy: 'governed_by',
  // domain.schema: operation precondition rules (operation.preconditions[])
  Preconditions: 'preconditions',
  // domain.schema: operation postcondition rules (operation.postconditions[])
  Postconditions: 'postconditions',
  // domain.schema: operation capability dependency on other operations (operation.requires[])
  Requires: 'requires',
  // --- Causal chain (domain.schema) -----------------------------------------
  // The command→event→command backbone. Absent from this builder until 2026-07-25, which made
  // `bp neighbors`/`subgraph`/`impact` and MCP get_neighbors/get_relations/get_impact_report
  // silently omit causality; the public model-builder always had them. Values match the public
  // builder exactly — the two feed one shared semantic-rule pack.
  // domain.schema: command produces events (operation.produces.operations[])
  Produces: 'produces',
  // domain.schema: operation reacts to a triggering operation (operation.reacts_to[].operation)
  ReactsTo: 'reacts_to',
  // domain.schema: actors that can trigger this operation (operation.initiated_by[])
  InitiatedBy: 'initiated_by',
  // domain.schema: operation's lifecycle effect on a concept (operation.materializes[].concept)
  Materializes: 'materializes',
  // domain.schema: operation can raise a catalog error (operation.responses[].error)
  RaisesError: 'raises_error',
  // domain.schema: operation payload references a data model (operation.payload.schema → Models)
  PayloadModel: 'payload_model',
  // decisions.schema: decision motivated by goal/risk/assumption/trade_off
  MotivationRefs: 'motivation_refs',
  // decisions.schema: decision enabling/supporting capabilities (decision.capability_refs[])
  CapabilityRefs: 'capability_refs',
  // decisions.schema: decision's declared impact on blueprint entities
  DeclaredImpact: 'declared_impact',
  // test-cases.schema: test case validates rule/operation/concept
  Validates: 'validates',
  // arch.schema: context structurally contains service (hierarchy from YAML nesting)
  Contains: 'contains',
  // arch.schema: service structurally provides contract (hierarchy from YAML nesting)
  Provides: 'provides',
  // --- Contract → operation wiring (arch.schema) ----------------------------
  // Typed operation_refs on a service contract, joining the arch plane to the domain plane.
  // `handled_by` is DERIVED from these (D13/D15) and was already materialized; the underlying
  // edges were not, so a contract-wired operation looked unreferenced. Values match the public
  // builder exactly.
  ContractExposes: 'contract_exposes',
  ContractCalls: 'contract_calls',
  ContractSends: 'contract_sends',
  ContractReceives: 'contract_receives',
  // motivation.schema: goal tracked by KPI (goal.kpi)
  GoalKpi: 'goal.kpi',
  // story.schema: story orders operations (story → operation, with position)
  StoryOrdersOperation: 'story_orders_operation',
  // org.schema: party structurally contains department
  OrgContainsDept: 'org_contains_dept',
  // org.schema: department has team
  DeptHasTeam: 'dept_has_team',
  // org.schema: party structurally contains team (direct teams)
  OrgContainsTeam: 'org_contains_team',
  // ui.schema: screen uses/displays model
  ScreenUsesModel: 'screen_uses_model',
  // ui.schema: screen motivated by goal
  ScreenMotivatedBy: 'screen_motivated_by',
  // ui.schema: screen shaped by decision
  ScreenDecision: 'screen_decision',
  // ui.schema: screen validated by test
  ScreenValidatedBy: 'screen_validated_by',
  // ui.schema: screen participates in story
  ScreenStory: 'screen_story',
  // ui.schema: action belongs to screen
  ActionOnScreen: 'action_on_screen',
  // ui.schema: action triggers operation
  ActionTriggersOperation: 'action_triggers_operation',
  // ui.schema: navigation source screen
  NavFrom: 'nav_from',
  // ui.schema: navigation target screen
  NavTo: 'nav_to',
  // domain.schema: question answered by operation (any kind: CMD, EVT, QRY, DOC)
  QuestionAnsweredBy: 'question_answered_by',
  // domain.schema: question about concept
  QuestionAbout: 'question_about',
  // domain.schema: question motivated by goal
  QuestionMotivatedBy: 'question_motivated_by',
  // domain.schema: question stakeholder (actor)
  QuestionStakeholder: 'question_stakeholder',
  // test-cases.schema: test case validates question answer quality
  TestValidatesQuestion: 'test_validates_question',
  // decisions.schema: decision motivated by question
  DecisionMotivatedByQuestion: 'decision_motivated_by_question',
  // code_refs: entity references code file
  CodeRef: 'code_ref',
  // domain.schema: operation example validates test case (example.test_ref)
  ExampleValidates: 'example_validates',
  // story.schema (v2.5): user story actor reference (user_story.actor)
  UserStoryActor: 'user_story_actor',
  // story.schema (v2.5): user story exercises operation (user_story.operations[])
  UserStoryOperation: 'user_story_operation',
  // story.schema (v2.5): user story validated by test (user_story.test_cases[])
  UserStoryTestCase: 'user_story_test_case',
  // story.schema (v2.5): user story belongs to use case (user_story.use_case)
  UserStoryUseCase: 'user_story_use_case',
  // story.schema (v2.5): use case primary actor (use_case.primary_actor)
  UseCaseActor: 'use_case_actor',
  // story.schema (v2.5): use case contains user stories (use_case.user_stories[])
  UseCaseUserStory: 'use_case_user_story',
  // story.schema (v2.5): use case implemented by story (use_case.stories[])
  UseCaseStory: 'use_case_story',
  // story.schema (v2.5): use case step references screen (main_scenario[].screen)
  UseCaseScreen: 'use_case_screen',
  // story.schema (v2.5): use case step references operation (main_scenario[].operation)
  UseCaseOperation: 'use_case_operation',
  // roadmap.schema (v2.5): milestone depends on milestone (milestone.dependencies[])
  MilestoneDependency: 'milestone_dependency',
  // roadmap.schema (v2.5): milestone delivers entity (milestone.deliverables[].ref)
  MilestoneDeliverable: 'milestone_deliverable',
  // domain.schema (v2.5): question owned by actor (question.owner)
  QuestionOwner: 'question_owner',
  // motivation.schema (v2.5): risk owned by actor (risk.owner)
  RiskOwner: 'risk_owner',
  // motivation.schema (v2.5): inquiry references goal (inquiry.goal_refs[])
  InquiryGoal: 'inquiry_goal',
  // motivation.schema (v2.5): inquiry references risk (inquiry.risk_refs[])
  InquiryRisk: 'inquiry_risk',
  // motivation.schema (v2.5): inquiry references domain question (inquiry.question_refs[])
  InquiryQuestion: 'inquiry_question',
  // motivation.schema (v2.5): inquiry owned by actor (inquiry.owner)
  InquiryOwner: 'inquiry_owner',
  // motivation.schema (v2.5): inquiry stakeholder actor (inquiry.stakeholders[])
  InquiryStakeholder: 'inquiry_stakeholder',
  // motivation.schema (v2.5): risk references goal (risk.goal_refs[])
  RiskGoal: 'risk_goal',
  // motivation.schema (v2.7.7 vision CR, D045): the singular vision's forward-links — the
  // "identity → objectives → competencies → delivery" chain, made queryable.
  // vision → goal (vision.advances_goals[])
  VisionAdvancesGoal: 'vision_advances_goal',
  // vision → capability (vision.capability_refs[])
  VisionCapability: 'vision_capability',
  // vision → value stream (vision.value_stream_refs[])
  VisionValueStream: 'vision_value_stream',
  // capability.schema (v2.5): capability references goal (capability.goal_refs[])
  CapabilityGoal: 'capability_goal',
  // motivation.schema (v2.5): assumption references risk (assumption.risk_refs[])
  AssumptionRisk: 'assumption_risk',
  // value-stream.schema (v2.6): value stream stage references capability (stages[].capabilities[])
  ValueStreamCapability: 'value_stream_capability',
  // value-stream.schema (v2.6): value stream references goal (goal_refs[])
  ValueStreamGoal: 'value_stream_goal',
  // value-stream.schema (v2.6): value stream references KPI (metrics[])
  ValueStreamKpi: 'value_stream_kpi',
  // value-stream.schema (v2.6): value stream primary actor (primary_actors[])
  ValueStreamActor: 'value_stream_actor',
  // BCC v5 (v2.6.3): bounded-context association from BD/Assumption/KPI to context
  // Source field: bounded_context_ref on business_decision, assumption, kpi
  BoundedContextRef: 'bounded_context_ref',
  // v2.7.6 (D15): operation handled/produced by a bounded context. Materialized (not
  // authored) — derived from arch service contracts (expose ∪ send = provide, PRIMARY,
  // many-to-many) with the deprecated file name/scope heuristic as FALLBACK. Carries
  // data.resolution: 'contract' | 'legacy'. The context map reads this edge (step-12).
  HandledBy: 'handled_by',
  // v2.7.6 (D17): competency question scoped to the bounded context whose knowledge
  // boundary it defines. Materialized — SINGLE-VALUED, from the question's explicit
  // bounded_context_ref (PRIMARY) with name/scope as FALLBACK. data.resolution: 'ref' | 'legacy'.
  ScopedTo: 'scoped_to',
  // BCC v5 (v2.6.3): cross-context business-decision policy linkage (BD.linked_contexts[])
  BusinessDecisionLinkedContext: 'business_decision_linked_context',
  // BCC v5 (v2.6.3): business-decision motivated by user story (BD.linked_user_stories[])
  BusinessDecisionLinkedUserStory: 'business_decision_linked_user_story',
  // rg.schema (Step 01 / D26): resource owned by org team (resource.owner.team → Team).
  OwnedByTeam: 'owned_by_team',
  // rg.schema (Step 01 / D26): arch service deployed in deployment tier (topology.tiers[].services[] → Service).
  DeployedInTier: 'deployed_in_tier',
  // infrastructure.schema (v2.7.7 CR-1): TOSCA-derived inter-resource relations
  // (resource.relations[] — InfraResource → InfraResource). `hosted_on` is the canonical
  // placement edge (distinct from the DeploymentTier `contains` grouping VIEW, so the two
  // never double-count, G8). connects_to/routes_to may cross environments/substrates for a
  // hybrid `network-link` interconnect.
  HostedOn: 'hosted_on',
  ConnectsTo: 'connects_to',
  DependsOn: 'depends_on',
  AttachesTo: 'attaches_to',
  RoutesTo: 'routes_to',
  // infrastructure.schema (v2.7.7 CR-2): the three-altitude intent→binding→instance edges.
  // needs: arch Service → ResourceType (abstract intent, service.needs[].type_ref).
  Needs: 'needs',
  // uses_resource: arch Service → InfraResource (concrete intent, service.resource_refs[]).
  UsesResource: 'uses_resource',
  // realizes_type: InfraResource/Binding → ResourceType (resource.type_ref / binding.type_ref).
  RealizesType: 'realizes_type',
  // binds: Binding → Environment (binding.environment_ref) and Binding → InfraResource
  // (binding.resource_ref) — the (type × environment) → concrete-resource bridge.
  Binds: 'binds',
  // infrastructure.schema (v2.7.7 DeploymentScope CR): management-grouping edges — the
  // NON-TOSCA counterpart to `hosted_on` (runtime placement). Extraction-emitted from ref
  // fields, so the five TOSCA verbs stay frozen (SD4). A resource may be BOTH `grouped_in`
  // a scope (who manages it) and `hosted_on` a host (what it runs on) — distinct, not
  // double-counted (the RG-vs-pool distinction, SD2).
  // grouped_in: InfraResource → DeploymentScope (resource.scope_ref).
  GroupedIn: 'grouped_in',
  // nested_in: DeploymentScope → DeploymentScope (scope.parent — subscription→resource-group).
  NestedIn: 'nested_in',
  // targets_scope: Environment → DeploymentScope (environment.target_scope.ref — promoted inline scope).
  TargetsScope: 'targets_scope',
  // roadmap.schema (v2.7.2): work item rolls up to milestone / release (work_item.milestone)
  WorkItemMilestone: 'work_item_milestone',
  // roadmap.schema (v2.7.2): parent work item contains child work item (work_item.children[])
  WorkItemChild: 'work_item_child',
  // roadmap.schema (v2.7.2): work item depends on work item / milestone (work_item.depends_on[])
  WorkItemDependency: 'work_item_dependency',
  // roadmap.schema (v2.7.2): work item blocked by work item / milestone / inquiry (work_item.blockers[].blocked_by[])
  WorkItemBlockedBy: 'work_item_blocked_by',
  // roadmap.schema (v2.7.2): roadmap item (milestone|work_item) advances goal (advances_goals[])
  RoadmapAdvancesGoal: 'roadmap_advances_goal',
  // roadmap.schema (v2.7.2): roadmap item mitigates risk (mitigates_risks[])
  RoadmapMitigatesRisk: 'roadmap_mitigates_risk',
  // roadmap.schema (v2.7.2): roadmap item realizes decision (realizes_decisions[])
  RoadmapRealizesDecision: 'roadmap_realizes_decision',
  // roadmap.schema (v2.7.2): roadmap item contributes to value stream (value_streams[])
  RoadmapValueStream: 'roadmap_value_stream',
  // roadmap.schema (v2.7.2): roadmap item delivers user story (user_stories[])
  RoadmapUserStory: 'roadmap_user_story',
  // roadmap.schema (v2.7.2): roadmap item delivers use case (use_cases[])
  RoadmapUseCase: 'roadmap_use_case',
  // leverage.schema (v2.7.4): leverage point remediates AS-IS finding (finding_refs[])
  LeverageFinding: 'leverage_finding',
  // leverage.schema (v2.7.4): leverage point mitigates risk (risk_refs[])
  LeverageRisk: 'leverage_risk',
  // leverage.schema (v2.7.4): leverage point bundles / is realized through decision (decision_refs[])
  LeverageDecision: 'leverage_decision',
  // leverage.schema (v2.7.4): leverage point establishes / relies on fitness function (fitness_function_refs[])
  LeverageFitnessFunction: 'leverage_fitness_function',
  // leverage.schema (v2.7.4): leverage point implemented by migration (migration_refs[])
  LeverageMigration: 'leverage_migration',
  // leverage.schema (v2.7.4): leverage point delivered/sequenced by roadmap work item (realized_by[])
  LeverageRealizedBy: 'leverage_realized_by',
  // leverage.schema (v2.7.4): leverage point advances goal (advances_goals[])
  LeverageAdvancesGoal: 'leverage_advances_goal',
  // leverage.schema (v2.7.4): leverage point advances value stream (advances_value_streams[])
  LeverageValueStream: 'leverage_value_stream',
  // leverage.schema (v2.7.4): leverage point strengthens capability (capability_refs[])
  LeverageCapability: 'leverage_capability',
  // leverage.schema (v2.7.4): leverage DAG — dependent LP → prerequisite LP (depends_on[] + inverse of enables[])
  LeverageDependsOn: 'leverage_depends_on',
  // dynamics.schema: the runtime-behaviour layer's edges, all of them Dynamics → Operation.
  //
  // Every name here is PREFIXED with its family, and that is not decoration. `Requires: 'requires'`
  // already exists above for domain preconditions, so an `ordering[].requires[]` edge typed
  // `requires` would be one type name covering two ontologically different relations - a
  // precondition on an operation and a runtime prerequisite between operations - and any
  // declarative rule matching the string would match both. `LeverageDependsOn` is the precedent in
  // this same file; `DependsOn` is the counter-example it was created to avoid becoming.
  //
  // parallelism_opportunity.operations[]: these may run concurrently within the opportunity
  ParallelismOperation: 'parallelism_operation',
  // ordering_constraint.operations[]: the operations the constraint is ABOUT
  OrderingOperation: 'ordering_operation',
  // ordering_constraint.requires[]: must complete BEFORE the constraint's subject can start
  OrderingRequires: 'ordering_requires',
  // ordering_constraint.enables[]: becomes eligible AFTER the constraint's subject completes
  OrderingEnables: 'ordering_enables',
  // ordering_constraint.can_parallel_with[]: declared safe concurrency (zero corpus instances)
  OrderingParallelWith: 'ordering_parallel_with',
  // race_condition.affects[]: the operation or concept the hazard touches
  RaceConditionAffects: 'race_condition_affects',
} as const;

export type RelationType = (typeof RELATION_TYPE)[keyof typeof RELATION_TYPE];
