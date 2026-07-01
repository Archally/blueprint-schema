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
  // arch.schema: context depends on another context / external system (context.dependencies[])
  DependsOn: 'depends_on',
  // arch.schema: service contract exposes a domain operation (contract.expose[] → Operation)
  ContractExposes: 'contract_exposes',
  // arch.schema: service contract calls a domain operation on a dependency (contract.call[] → Operation)
  ContractCalls: 'contract_calls',
  // arch.schema: service contract publishes a domain operation as a message (contract.send[] → Operation)
  ContractSends: 'contract_sends',
  // arch.schema: service contract consumes a domain operation as a message (contract.receive[] → Operation)
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
  // BCC v5 (v2.6.3): cross-context business-decision policy linkage (BD.linked_contexts[])
  BusinessDecisionLinkedContext: 'business_decision_linked_context',
  // BCC v5 (v2.6.3): business-decision motivated by user story (BD.linked_user_stories[])
  BusinessDecisionLinkedUserStory: 'business_decision_linked_user_story',
  // domain.schema: command produces event/document (operation.produces.operations[])
  Produces: 'produces',
  // domain.schema: command reacts to event (operation.reacts_to[].operation)
  ReactsTo: 'reacts_to',
  // domain.schema: operation initiated by actor (operation.initiated_by[])
  InitiatedBy: 'initiated_by',
  // domain.schema: operation materializes concept (operation.materializes[].concept)
  Materializes: 'materializes',
  // domain.schema: operation can raise a catalog error (operation.responses[].error → Error)
  RaisesError: 'raises_error',
  // rg.schema (Step 01 / D26): resource owned by org team (resource.owner.team → Team).
  OwnedByTeam: 'owned_by_team',
  // rg.schema (Step 01 / D26): arch service deployed in deployment tier (topology.tiers[].services[] → Service).
  DeployedInTier: 'deployed_in_tier',
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
} as const;

export type RelationType = (typeof RELATION_TYPE)[keyof typeof RELATION_TYPE];
