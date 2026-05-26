import { describe, it, expect } from 'vitest';
import { extractUseCaseRelations } from './useCase.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function makeEntity(overrides: Partial<Entity> & { id: string; displayId: string; type: string }): Entity {
  return { layer: 'design.story', fileOrigin: 'orders/story.yaml', ...overrides };
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
      makeEntity({ id: 'orders-story.yaml-STR001', displayId: 'STR001', type: ENTITY_TYPE.Story }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUseCaseRelations(entities, placeholders);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseStory)).toHaveLength(1);
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
      makeEntity({ id: 'orders-interactions.yaml-SCR001', displayId: 'SCR001', type: ENTITY_TYPE.Screen, fileOrigin: 'orders/interactions.yaml' }),
      makeEntity({ id: 'orders-interactions.yaml-SCR002', displayId: 'SCR002', type: ENTITY_TYPE.Screen, fileOrigin: 'orders/interactions.yaml' }),
      makeEntity({ id: 'orders-domain.yaml-CMD001', displayId: 'CMD001', type: ENTITY_TYPE.Operation, fileOrigin: 'orders/domain.yaml' }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUseCaseRelations(entities, placeholders);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseScreen)).toHaveLength(2);
    expect(relations.filter((r) => r.type === RELATION_TYPE.UseCaseOperation)).toHaveLength(1);
  });

  it('ignores non-UseCase entities', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'x', displayId: 'US001', type: ENTITY_TYPE.UserStory, data: { primary_actor: 'ACT001' } }),
    ];
    const placeholders = new Map<string, Entity>();
    expect(extractUseCaseRelations(entities, placeholders)).toHaveLength(0);
  });
});
