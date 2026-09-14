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
  // --- Stakeholder and expectation -----------------------------------------
  // concepts.schema: the actor whose role a persona is an archetype of. Declared by a root-level
  // persona through `actor_ref`, and stated by position for one written inside its actor.
  PersonaActor: 'persona_actor',
  // motivation.schema: the persona who holds a concern (concern.persona_ref)
  ConcernPersona: 'concern_persona',
  // motivation.schema: what a concern is about (concern.about_ref) - a user story, a use case, a
  // business process, a screen or a concept. One edge type for all five, because a consumer asking
  // "what does this persona expect of that?" asks the same question whichever of them it names.
  ConcernAbout: 'concern_about',
  // story.schema: the standing expectation a user story addresses (user_story.concern_ref)
  UserStoryConcern: 'user_story_concern',
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
  // The same wiring for the three couplings that cross no wire. Separate types rather than a reuse
  // of the four above, because those four assert a channel: a rule or a view that reads
  // `contract_exposes` as "this operation has a transport surface" would be right about every
  // existing edge and wrong about an in-process one. `contract_writes` and `contract_reads` serve
  // BOTH data kinds, as `contract_exposes` already serves openapi and openrpc - the contract's own
  // `_contractType` says which kind produced the edge.
  ContractProvides: 'contract_provides',
  ContractConsumes: 'contract_consumes',
  ContractWrites: 'contract_writes',
  ContractReads: 'contract_reads',
  // motivation.schema: goal tracked by KPI (goal.kpi)
  GoalKpi: 'goal.kpi',
  // --- quality.schema: the measurement chain and the requirement planes ------
  // goal -> KPI -> metric -> operation/concept -> SLO -> SLA, plus the security, compliance and
  // resilience requirements that bind to what they govern.
  //
  // ONE TYPE PER (source, field) PAIR, not one per plane. A KPI that names a metric and an SLO
  // that names one are different statements - a business target and an operational commitment -
  // and a rule or a view filtering on the type has to be able to tell them apart. The same
  // reasoning names `slo_operation` rather than reusing the domain plane's `requires`.
  //
  // metric.measures.operations[] / metric.measures.concepts[]. One type for both arms: the
  // target's own type says which produced it, as `owned_by` does for its three.
  MetricMeasures: 'metric_measures',
  // kpi.metric -> Metric: the measurement a business target is read from.
  KpiMetric: 'kpi_metric',
  // kpi.goal -> Goal. `goal.kpi` above is the same join written from the other side; a model may
  // author either, so both are extracted and stay distinct edges - which side stated the link is
  // part of what the model says.
  KpiGoal: 'kpi_goal',
  // kpi.owner -> Actor: who answers for the target.
  KpiOwner: 'kpi_owner',
  // slo.metric -> Metric: the measurement the objective is stated against.
  SloMetric: 'slo_metric',
  // slo.operations[] -> Operation: what the objective constrains.
  SloOperation: 'slo_operation',
  // slo.resource_refs[] -> InfraResource: the concrete host or store it is measured on.
  SloResource: 'slo_resource',
  // sla.slos[] -> SLO: the objectives a contractual commitment is built on. `sla.parties.*` names
  // a provider or consumer in prose rather than by reference, so it builds no edge.
  SlaSlo: 'sla_slo',
  // security.operations[] -> Operation, security.concepts[] -> Concept: what a requirement governs
  // and what data it protects.
  SecurityOperation: 'security_operation',
  SecurityConcept: 'security_concept',
  // compliance.concepts[] -> Concept: the data a regulation governs. This is the edge that makes a
  // regulation usable as an impact seed.
  ComplianceConcept: 'compliance_concept',
  // resilience.resource_refs[] -> InfraResource: what the RTO and RPO are measured against.
  ResilienceResource: 'resilience_resource',
  // story.schema: story orders operations (story → operation, with position)
  ProcessOrdersOperation: 'process_orders_operation',
  // story.schema: an activity runs another process as a subprocess (process → process)
  ProcessCallsSubprocess: 'process_calls_subprocess',
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
  ScreenProcess: 'screen_process',
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
  UseCaseProcess: 'use_case_process',
  // story.schema (v2.5): use case step references screen (main_scenario[].screen)
  UseCaseScreen: 'use_case_screen',
  // story.schema (v2.5): use case step references operation (main_scenario[].operation)
  UseCaseOperation: 'use_case_operation',
  // story.schema (v2.8.8): use case involves an actor it does not initiate from (secondary_actors[])
  UseCaseSecondaryActor: 'use_case_secondary_actor',
  // story.schema (v2.8.8): use case always performs another (use_case.includes[])
  UseCaseIncludes: 'use_case_includes',
  // story.schema (v2.8.8): use case conditionally extends another (use_case.extends[])
  UseCaseExtends: 'use_case_extends',
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
  // v2.8.1: where a governance concern sticks on the domain model - risk.affects.*_refs[],
  // inquiry.affects.*_refs[], finding.affects.*_refs[] (operation, concept, story). One type per
  // source, as `race_condition_affects`: the target's own type says what was affected.
  // A migration's three edges. All three are PREFIXED with the source type, for the reason the
  // `ContextDependsOn` / `LeverageDependsOn` comments below give: a bare `depends_on` already names
  // the TOSCA infrastructure verb, and a declarative rule matching the string would match both.
  MigrationDependsOn: 'migration_depends_on',
  MigrationRelatesToDecision: 'migration_relates_to_decision',
  // The coarse edge the ruling put in place of a per-change one, agnostic to what the change does.
  MigrationAffects: 'migration_affects',
  RiskAffects: 'risk_affects',
  InquiryAffects: 'inquiry_affects',
  FindingAffects: 'finding_affects',
  GoalAffects: 'goal_affects',
  // quality.schema: the AS-IS remediation chain's first hop, from the finding that observed the
  // problem to what the model decided about it - finding.risk_refs[], finding.decision_refs[],
  // finding.migration_ref. The schema states the chain finding -> risk -> decision -> migration in
  // two places; these are the edges that make it navigable rather than asserted.
  FindingRisk: 'finding_risk',
  FindingDecision: 'finding_decision',
  FindingMigration: 'finding_migration',
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
  // arch.schema: Context → Context strategic dependency (context.dependencies[]), carrying the
  // declared relationship / direction / integration type.
  //
  // PREFIXED, and it is the whole point of the name. This edge and the TOSCA
  // InfraResource → InfraResource `depends_on` below are different relations that share a
  // preposition: one is a strategic statement about two bounded contexts, the other a placement
  // statement about two resources. While both were spelled `depends_on`, any rule or consumer
  // filtering on the string matched both - on a model carrying 13 such edges, 3 were resource
  // pairs, so a rule about context dependencies was wrong on nearly a quarter of its input and
  // looked fine. `LeverageDependsOn` is the same treatment applied when its collision was foreseen
  // rather than discovered.
  //
  // The ARCH side is the one that moved: `depends_on` is TOSCA's own verb name, mapped 1:1 from the
  // source document, so renaming that side would put a translation between the model and the
  // standard it quotes.
  ContextDependsOn: 'context_depends_on',
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
  //
  // Named for the FIELD it reads, not for its endpoints. `resource_owner.team` holds a free-string
  // team NAME (`design/infrastructure.schema.yaml`: "Owning team name"), which is a different
  // statement from the typed `TM###` reference `owned_by.team` carries. The two have separate
  // relation types so a consumer can tell a named team from a referenced one.
  ResourceOwnerTeam: 'resource_owner_team',
  // The system a service is a component of: Service -> Party. Stated by position for a service
  // nested under a party, by `system_ref` for a service under a root-declared context, or by the
  // document's `system_ref` default (then `data.inherited`). Named for the field, as `owned_by` is,
  // and distinct from it: `owned_by` says who owns the service, this says what it is part of.
  SystemRef: 'system_ref',
  // The systems a bounded context spans: Context -> Party, one edge per distinct system among the
  // context's services (plus the envelope party of a nested context). Derived, never authored: a
  // context that several systems provide services to has several, which the nested form could only
  // state by declaring the context once per system.
  Spans: 'spans',
  // The organizational ownership edge: any unit that declares `owned_by` → the Team, Department or
  // Party named by the one arm it sets. ONE type serves all three arms, because the arm is
  // recoverable from the target entity's type; `data.arm` carries it as well, so the edge is
  // self-describing without a second lookup.
  OwnedBy: 'owned_by',
  // A directed, typed relationship between two parties (party.relations[]). ONE type for all five
  // values, as `owned_by` and `interacts_with` do, with `data.type` naming which. The id carries the
  // type: one party may be both `supplier_to` and `partner_of` another, and those are two facts
  // about one pair that an id built from the endpoints alone would deduplicate into one.
  PartyRelation: 'party_relation',
  // A department inside another department (department.parent), for an organization deeper than two
  // levels. Runs from the declaring department to its parent, the direction the field is written in.
  DeptParent: 'dept_parent',
  // `actor.staffed_by` → the Team whose members perform the actor's role. It completes the path from
  // a scenario step to the team that performs it: a step names an actor, or names an operation whose
  // `initiated_by` does, and the actor names the team.
  StaffedBy: 'staffed_by',
  // `team.interacts_with[]` and `department.interacts_with[]` → the Team, Department or Party the
  // declaring unit depends on. ONE type for all three arms, as `owned_by` does, with `data.nature`
  // carrying the class of dependency and `data.arm` the arm that produced it. `nature` is what a
  // consumer filters on: only `architectural` edges make a claim the graph can derive on its own.
  InteractsWith: 'interacts_with',
  // rg.schema (Step 01 / D26): arch service deployed in deployment tier (topology.tiers[].services[] → Service).
  DeployedInTier: 'deployed_in_tier',
  // infrastructure.schema (v2.7.7 CR-1): TOSCA-derived inter-resource relations
  // (resource.relations[] — InfraResource → InfraResource). `hosted_on` is the canonical
  // placement edge (distinct from the DeploymentTier `contains` grouping VIEW, so the two
  // never double-count, G8). connects_to/routes_to may cross environments/substrates for a
  // hybrid `network-link` interconnect.
  HostedOn: 'hosted_on',
  ConnectsTo: 'connects_to',
  // TOSCA's own verb, and its alone since the arch edge became `context_depends_on` above.
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
  // arch.schema (2.8.2): arch Service → Environment, from `service.servers[].environment` where the
  // server names the environment by its typed id. A NAME builds no edge, because a name is not a
  // reference and resolves to nothing; the semantic rule `environment-named-not-declared` is what
  // reports one that matches no declared environment. Distinct from `deployed_in_tier`: a tier is a
  // topology grouping inside one deployment, an environment is the binding dimension across them.
  DeployedInEnvironment: 'deployed_in_environment',
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
  // --- v2.8.6 problem-space registry (blueprint.yaml root `domains:`) -------
  // A subdomain nested under a Domain (positional, from `domains[].subdomains[]` - no field
  // named `parent`, the way arch's `Contains` reads YAML nesting rather than a ref). Runs from
  // the declaring Subdomain to its Domain, the direction `DeptParent` above uses for the same
  // shape of fact.
  SubdomainOfDomain: 'subdomain_of_domain',
  // A bounded context's `domain_ref` (arch.schema `parties[].contexts[]` / root `contexts[]`),
  // when the value is a typed Domain id (`^DMN\d{3,}$`) rather than an older model's slice name.
  // PREFIXED with the source type, as `ContextDependsOn` is above: "realizes" already names the
  // roadmap→decision edge (`RoadmapRealizesDecision`), and a bare `realizes` would blur the two.
  ContextRealizesDomain: 'context_realizes_domain',
  // v2.8.7: a bounded context's `domain_ref` naming a Subdomain (`^SDM\d{3,}$`) instead of a
  // Domain - the declared half of "BC connects to domain or subdomain, one ref" (owner's
  // ruling). The derived Domain edge this implies REUSES `context_realizes_domain` above rather
  // than a distinct type, so a consumer grouping contexts by domain sees one shape regardless of
  // which the author named.
  ContextRealizesSubdomain: 'context_realizes_subdomain',
  // An operation's problem-space domain, from the `domain_ref` in its document's header rather
  // than from the operation, which declares none by design. `data.resolution` says which source
  // answered: `file-header` where the document stated it, `folder` where the slice folder's name
  // matched a declared domain. The second word is deliberately the one `ContextRealizesDomain`
  // uses for the identical fallback - two edges answering "which domain" must not spell one
  // source two ways - while the first is more precise than that edge's `declared`, because here
  // the entity never declares and the file always does.
  OperationInDomain: 'operation_in_domain',
  // Which problem-space domains a context SERVES, which is n-to-n and is a different question from
  // the n-to-1 home `ContextRealizesDomain` carries. Derived by joining `HandledBy` with
  // `OperationInDomain`, so it walks the path the model already walks and introduces no second
  // matching rule; `covers[]` supplies the exception, for coverage no contract can express.
  // `data.resolution` is `contract`, `name` or `declared`. `name` is the weaker derived case: the
  // operations reached the context through the name-and-scope fallback rather than a contract, and
  // `handled_by` records that one as `exact` too, so reading its `match` alone would report a
  // coverage nobody wired as contract evidence. `data.match` therefore appears only on a
  // contract-carried edge, beside `operation_count` and `contract_operation_count`.
  ContextCoversDomain: 'context_covers_domain',
  // Which concepts a bounded context's language holds, which is n-to-n: every concept an operation the
  // context handles creates or changes (`materializes[].concept`, joined through `HandledBy`) and every
  // concept a question scoped to it is about (`concepts[]`, joined through `ScopedTo`). Derived from
  // those four edges and nothing else - no folder, scope or name match - so a concept no operation or
  // question names belongs to no context. `data.via` lists `operation` and/or `question`, beside
  // `operation_count` and `question_count`.
  ContextUsesConcept: 'context_uses_concept',
  // Context-to-context traffic the contract surface proves: an operation one context's service
  // exposes and another's calls. Drawn consumer to provider, the direction a call travels. It sits
  // BESIDE the declared `ContextDependsOn` and never replaces it - derivation reaches far fewer
  // pairs than declaration does, and in a model whose contracts wire nothing it reaches none at
  // all, so promoting derivation to the only source would turn every unauthored contract into a
  // denial.
  // `data` carries `protocols`, `operations`, `operation_count` and `broker_ids`; there is no
  // `match`, because this path resolves refs through the documented formats only and has no
  // looser tier for such a field to describe.
  ContractTraffic: 'contract_traffic',
} as const;

export type RelationType = (typeof RELATION_TYPE)[keyof typeof RELATION_TYPE];
