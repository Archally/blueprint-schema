import { describe, it, expect } from 'vitest';
import { extractUseCaseRelations } from './useCase.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function makeEntity(overrides: Partial<Entity> & { id: string; displayId: string; type: string }): Entity {
  return { layer: 'design.process', fileOrigin: 'orders/story.yaml', ...overrides };
}

describe('extractUseCaseRelations', () => {
  it('creates primary_actor relation', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-UC001', displayId: 'UC001', type: ENTITY_TYPE.UseCase,
        data: { id: 'UC001', name: 'Place Order', primary_actor: 'ACT001' },
      }),
      makeEntity({ id: 'orders-concepts.yaml-ACT001', displayId: 'ACT001', type: ENTITY_TYPE.Actor, fileOrigin: 'orders/concepts.yaml' }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUseCaseRelations(entities, placeholders);
    const actorRels = relations.filter((r) => r.type === RELATION_TYPE.UseCaseActor);
    expect(actorRels).toHaveLength(1);
    expect(actorRels[0]!.target_entity_id).toBe('orders-concepts.yaml-ACT001');
  });

  it('creates user_stories[] relations', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-UC001', displayId: 'UC001', type: ENTITY_TYPE.UseCase,
        data: { id: 'UC001', name: 'Place Order', primary_actor: 'ACT001', user_stories: ['US001', 'US002'] },
      }),
      makeEntity({ id: 'orders-story.yaml-US001', displayId: 'US001', type: ENTITY_TYPE.UserStory }),
      makeEntity({ id: 'orders-story.yaml-US002', displayId: 'US002', type: ENTITY_TYPE.UserStory }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUseCaseRelations(entities, placeholders);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseUserStory)).toHaveLength(2);
  });

  it('creates stories[] relations to STR###', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-UC001', displayId: 'UC001', type: ENTITY_TYPE.UseCase,
        data: { id: 'UC001', name: 'Place Order', primary_actor: 'ACT001', stories: ['STR001'] },
      }),
      makeEntity({ id: 'orders-story.yaml-STR001', displayId: 'STR001', type: ENTITY_TYPE.Process }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUseCaseRelations(entities, placeholders);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseProcess)).toHaveLength(1);
  });

  it('extracts screen and operation refs from main_scenario steps', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-UC001', displayId: 'UC001', type: ENTITY_TYPE.UseCase,
        data: {
          id: 'UC001', name: 'Place Order', primary_actor: 'ACT001',
          main_scenario: [
            { step: 1, action: 'Browse', screen: 'SCR001' },
            { step: 2, action: 'Checkout', operation: 'CMD001', screen: 'SCR002' },
            { step: 3, action: 'Confirm' },
          ],
        },
      }),
      makeEntity({ id: 'orders-ui.yaml-SCR001', displayId: 'SCR001', type: ENTITY_TYPE.Screen, fileOrigin: 'orders/ui.yaml' }),
      makeEntity({ id: 'orders-ui.yaml-SCR002', displayId: 'SCR002', type: ENTITY_TYPE.Screen, fileOrigin: 'orders/ui.yaml' }),
      makeEntity({ id: 'orders-domain.yaml-CMD001', displayId: 'CMD001', type: ENTITY_TYPE.Operation, fileOrigin: 'orders/domain.yaml' }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUseCaseRelations(entities, placeholders);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseScreen)).toHaveLength(2);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseOperation)).toHaveLength(1);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseUiAction)).toHaveLength(0);
  });

  it('ignores non-UseCase entities', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'x', displayId: 'US001', type: ENTITY_TYPE.UserStory, data: { primary_actor: 'ACT001' } }),
    ];
    const placeholders = new Map<string, Entity>();
    expect(extractUseCaseRelations(entities, placeholders)).toHaveLength(0);
  });
});

/** A step names its performer through `operation` and its `initiated_by` actor,
* or through `actor` when no operation is present. Extension actors also produce graph edges.
*/
describe('a use case step reaches the actor that performs it', () => {
  const actor = (displayId: string): Entity =>
    makeEntity({
      id: `orders-concepts.yaml-${displayId}`,
      displayId,
      type: ENTITY_TYPE.Actor,
      fileOrigin: 'orders/concepts.yaml',
    });

  const useCase = (data: Record<string, unknown>): Entity =>
    makeEntity({
      id: 'orders-story.yaml-UC001',
      displayId: 'UC001',
      type: ENTITY_TYPE.UseCase,
      data: { id: 'UC001', name: 'Release', ...data },
    });

  const actorTargets = (entities: Entity[]): string[] =>
    extractUseCaseRelations(entities, new Map<string, Entity>())
      .filter((relation) => relation.type === RELATION_TYPE.UseCaseActor)
      .map((relation) => relation.target_entity_id);

  it('emits UseCaseActor for a main-scenario step that names an actor', () => {
    const entities = [
      useCase({ main_scenario: [{ step: 1, action: 'Release manager signs off', actor: 'ACT002' }] }),
      actor('ACT002'),
    ];
    expect(actorTargets(entities)).toEqual(['orders-concepts.yaml-ACT002']);
  });

  it('emits UseCaseActor for an extension that names an actor', () => {
    const entities = [
      useCase({ extensions: [{ step: 1, condition: 'sign-off refused', action: 'Escalate', actor: 'ACT003' }] }),
      actor('ACT003'),
    ];
    expect(actorTargets(entities)).toEqual(['orders-concepts.yaml-ACT003']);
  });

  it('reaches a step actor and the primary actor from the same use case', () => {
    // A shared primary actor and step actor retain their distinct edge identities.
    const entities = [
      useCase({
        primary_actor: 'ACT001',
        main_scenario: [{ step: 1, action: 'Release manager signs off', actor: 'ACT002' }],
      }),
      actor('ACT001'),
      actor('ACT002'),
    ];
    expect(actorTargets(entities).sort()).toEqual([
      'orders-concepts.yaml-ACT001',
      'orders-concepts.yaml-ACT002',
    ]);
  });

  it('ignores `actor` on a step that also names an operation, so a performer has one source of truth', () => {
    // The schema's rule for both spellings is "consulted only when `operation` is absent". The step
    // here carries BOTH, which is the only shape that tests the rule: a step with an operation and
    // no actor would pass whether the rule were enforced or not.
    const entities = [
      useCase({
        main_scenario: [{ step: 1, action: 'Place the order', operation: 'CMD001', actor: 'ACT002' }],
      }),
      makeEntity({ id: 'orders-domain.yaml-CMD001', displayId: 'CMD001', type: ENTITY_TYPE.Command }),
      actor('ACT002'),
    ];
    expect(actorTargets(entities)).toEqual([]);
    // ...and the operation edge is still there, so the step was read rather than skipped.
    const relations = extractUseCaseRelations(entities, new Map<string, Entity>());
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseOperation)).toHaveLength(1);
  });
});

/** A step-derived edge carries its array index, so two steps naming one target stay two edges
* when relations are deduplicated globally.
*/
describe('a step-derived edge is identified by its step, not only by its endpoints', () => {
  const actor = (displayId: string): Entity =>
    makeEntity({
      id: `orders-concepts.yaml-${displayId}`,
      displayId,
      type: ENTITY_TYPE.Actor,
      fileOrigin: 'orders/concepts.yaml',
    });

  const useCase = (data: Record<string, unknown>): Entity =>
    makeEntity({
      id: 'orders-story.yaml-UC001',
      displayId: 'UC001',
      type: ENTITY_TYPE.UseCase,
      data: { id: 'UC001', name: 'Release', ...data },
    });

  const actorEdges = (entities: Entity[]) =>
    extractUseCaseRelations(entities, new Map<string, Entity>()).filter(
      (relation) => relation.type === RELATION_TYPE.UseCaseActor,
    );

  /** Distinct edge ids preserve separate steps during global deduplication.
  * The array index distinguishes branches that share a step number and target.
  */
  const distinctActorEdgeIds = (entities: Entity[]): number =>
    new Set(actorEdges(entities).map((edge) => edge.id)).size;

  it('keeps two edges when two steps name the same actor', () => {
    const entities = [
      useCase({
        main_scenario: [
          { step: 1, action: 'Release manager signs off', actor: 'ACT002' },
          { step: 5, action: 'Release manager confirms rollout', actor: 'ACT002' },
        ],
      }),
      actor('ACT002'),
    ];
    const edges = actorEdges(entities);
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((edge) => edge.id)).size, 'the two edges must have different ids').toBe(2);
  });

  it('keeps the primary actor edge and a step edge naming the same actor', () => {
    // The exact shape found in the corpus: a use case whose primary actor also performs a branch.
    const entities = [
      useCase({
        primary_actor: 'ACT005',
        extensions: [{ step: 2, condition: 'freeze breach', action: 'Escalate', actor: 'ACT005' }],
      }),
      actor('ACT005'),
    ];
    expect(actorEdges(entities)).toHaveLength(2);
    expect(distinctActorEdgeIds(entities)).toBe(2);
  });

  it('separates two extensions that declare the SAME step number', () => {
    // Extensions branch AT a step, so two alternatives may both say `step: 2`. The disambiguator is
    // therefore the array index; a `step`-keyed id would collapse these two back into one.
    const entities = [
      useCase({
        extensions: [
          { step: 2, condition: 'tests fail', action: 'Roll back', actor: 'ACT002' },
          { step: 2, condition: 'owner refuses', action: 'Escalate', actor: 'ACT002' },
        ],
      }),
      actor('ACT002'),
    ];
    expect(distinctActorEdgeIds(entities), 'two branches at step 2 are two edges').toBe(2);
  });

  it('reports the step and the scenario in `data`, so a consumer never parses the id', () => {
    const entities = [
      useCase({
        main_scenario: [{ step: 3, action: 'Sign off', actor: 'ACT002' }],
        extensions: [{ step: 7, condition: 'refused', action: 'Escalate', actor: 'ACT003' }],
      }),
      actor('ACT002'),
      actor('ACT003'),
    ];
    const edges = actorEdges(entities);
    expect(edges.map((edge) => edge.data)).toEqual([
      { scenario: 'main', step: 3 },
      { scenario: 'extension', step: 7 },
    ]);
  });

  it('leaves the primary_actor edge id unsuffixed, so existing ids do not move', () => {
    const entities = [useCase({ primary_actor: 'ACT001' }), actor('ACT001')];
    expect(actorEdges(entities)[0]!.id).toBe(
      'orders-story.yaml-UC001--use_case_actor--orders-concepts.yaml-ACT001',
    );
  });

  it('applies the same rule to step operations, which lose the most edges to the collision', () => {
    const entities = [
      useCase({
        main_scenario: [
          { step: 1, action: 'Submit', operation: 'CMD001' },
          { step: 4, action: 'Resubmit after review', operation: 'CMD001' },
        ],
      }),
      makeEntity({ id: 'orders-domain.yaml-CMD001', displayId: 'CMD001', type: ENTITY_TYPE.Command }),
    ];
    const operationEdges = extractUseCaseRelations(entities, new Map<string, Entity>()).filter(
      (relation) => relation.type === RELATION_TYPE.UseCaseOperation,
    );
    expect(new Set(operationEdges.map((edge) => edge.id)).size).toBe(2);
    expect(operationEdges.map((edge) => edge.data)).toEqual([
      { scenario: 'main', step: 1 },
      { scenario: 'main', step: 4 },
    ]);
  });
});

/**
 * A main-scenario step that names a UI action reaches that action in the graph.
 *
 * `step.action` is a plain-language string; `ui_action` is the typed UAC### the later walk binds.
 * Two steps may name one action, so the edge carries the array index the same way screen and
 * operation edges already do. alternative_flow does not declare the field and is not read.
 */
describe('a use case step reaches the UI action it performs', () => {
  const action = (displayId: string): Entity =>
    makeEntity({
      id: `orders-ui.yaml-${displayId}`,
      displayId,
      type: ENTITY_TYPE.UIAction,
      fileOrigin: 'orders/ui.yaml',
    });

  const useCase = (data: Record<string, unknown>): Entity =>
    makeEntity({
      id: 'orders-story.yaml-UC001',
      displayId: 'UC001',
      type: ENTITY_TYPE.UseCase,
      data: { id: 'UC001', name: 'Place Order', ...data },
    });

  const uiActionEdges = (entities: Entity[]) =>
    extractUseCaseRelations(entities, new Map<string, Entity>()).filter(
      (relation) => relation.type === RELATION_TYPE.UseCaseUiAction,
    );

  it('emits UseCaseUiAction for a main-scenario step that names ui_action', () => {
    const entities = [
      useCase({
        main_scenario: [{ step: 1, action: 'Submit the cart', ui_action: 'UAC001' }],
      }),
      action('UAC001'),
    ];
    const edges = uiActionEdges(entities);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target_entity_id).toBe('orders-ui.yaml-UAC001');
    expect(edges[0]!.data).toEqual({ scenario: 'main', step: 1 });
  });

  it('emits no UseCaseUiAction when no step names ui_action', () => {
    const entities = [
      useCase({
        main_scenario: [{ step: 1, action: 'Observe the confirmation', screen: 'SCR001' }],
      }),
    ];
    expect(uiActionEdges(entities)).toHaveLength(0);
  });

  it('keeps two edges when two steps name the same UI action', () => {
    const entities = [
      useCase({
        main_scenario: [
          { step: 1, action: 'Submit', ui_action: 'UAC001' },
          { step: 4, action: 'Submit again after review', ui_action: 'UAC001' },
        ],
      }),
      action('UAC001'),
    ];
    const edges = uiActionEdges(entities);
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(2);
    expect(edges.map((edge) => edge.data)).toEqual([
      { scenario: 'main', step: 1 },
      { scenario: 'main', step: 4 },
    ]);
  });

  it('does not read ui_action from alternative_flow even when the key is present', () => {
    const entities = [
      useCase({
        main_scenario: [{ step: 1, action: 'Submit', ui_action: 'UAC001' }],
        alternative_flows: [
          { step: 1, condition: 'payment fails', action: 'Retry', ui_action: 'UAC002' },
        ],
      }),
      action('UAC001'),
      action('UAC002'),
    ];
    const edges = uiActionEdges(entities);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target_entity_id).toBe('orders-ui.yaml-UAC001');
  });
});
