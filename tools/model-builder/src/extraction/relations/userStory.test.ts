import { describe, it, expect } from 'vitest';
import { extractUserStoryRelations } from './userStory.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function makeEntity(overrides: Partial<Entity> & { id: string; displayId: string; type: string }): Entity {
  return { layer: 'design.story', fileOrigin: 'orders/story.yaml', ...overrides };
}

describe('extractUserStoryRelations', () => {
  it('creates actor relation from user_story.actor', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-US001', displayId: 'US001', type: ENTITY_TYPE.UserStory,
        data: { id: 'US001', actor: 'ACT001', goal: 'test' },
      }),
      makeEntity({ id: 'orders-concepts.yaml-ACT001', displayId: 'ACT001', type: ENTITY_TYPE.Actor, fileOrigin: 'orders/concepts.yaml' }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUserStoryRelations(entities, placeholders);
    const actorRels = relations.filter((r) => r.type === RELATION_TYPE.UserStoryActor);
    expect(actorRels).toHaveLength(1);
    expect(actorRels[0]!.source_entity_id).toBe('orders-story.yaml-US001');
    expect(actorRels[0]!.target_entity_id).toBe('orders-concepts.yaml-ACT001');
  });

  it('creates operation relations from user_story.operations[]', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-US001', displayId: 'US001', type: ENTITY_TYPE.UserStory,
        data: { id: 'US001', actor: 'ACT001', goal: 'test', operations: ['CMD001', 'QRY001'] },
      }),
      makeEntity({ id: 'orders-domain.yaml-CMD001', displayId: 'CMD001', type: ENTITY_TYPE.Operation, fileOrigin: 'orders/domain.yaml' }),
      makeEntity({ id: 'orders-domain.yaml-QRY001', displayId: 'QRY001', type: ENTITY_TYPE.Operation, fileOrigin: 'orders/domain.yaml' }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUserStoryRelations(entities, placeholders);
    const opRels = relations.filter((r) => r.type === RELATION_TYPE.UserStoryOperation);
    expect(opRels).toHaveLength(2);
  });

  it('creates test case relations from user_story.test_cases[]', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-US001', displayId: 'US001', type: ENTITY_TYPE.UserStory,
        data: { id: 'US001', actor: 'ACT001', goal: 'test', test_cases: ['TC001'] },
      }),
      makeEntity({ id: 'orders-test-cases.yaml-TC001', displayId: 'TC001', type: ENTITY_TYPE.TestCase, fileOrigin: 'orders/test-cases.yaml' }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUserStoryRelations(entities, placeholders);
    const tcRels = relations.filter((r) => r.type === RELATION_TYPE.UserStoryTestCase);
    expect(tcRels).toHaveLength(1);
  });

  it('creates use_case back-pointer relation', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-US001', displayId: 'US001', type: ENTITY_TYPE.UserStory,
        data: { id: 'US001', actor: 'ACT001', goal: 'test', use_case: 'UC001' },
      }),
      makeEntity({ id: 'orders-story.yaml-UC001', displayId: 'UC001', type: ENTITY_TYPE.UseCase }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUserStoryRelations(entities, placeholders);
    const ucRels = relations.filter((r) => r.type === RELATION_TYPE.UserStoryUseCase);
    expect(ucRels).toHaveLength(1);
    expect(ucRels[0]!.target_entity_id).toBe('orders-story.yaml-UC001');
  });

  it('creates placeholder for unresolvable refs', () => {
    const entities: Entity[] = [
      makeEntity({
        id: 'orders-story.yaml-US001', displayId: 'US001', type: ENTITY_TYPE.UserStory,
        data: { id: 'US001', actor: 'ACT999', goal: 'test' },
      }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUserStoryRelations(entities, placeholders);
    expect(relations).toHaveLength(1);
    expect(placeholders.size).toBe(1);
    expect(Array.from(placeholders.values())[0]!.type).toBe(ENTITY_TYPE.Missing);
  });

  it('ignores non-UserStory entities', () => {
    const entities: Entity[] = [
      makeEntity({ id: 'x', displayId: 'STR001', type: ENTITY_TYPE.Story, data: { actor: 'ACT001' } }),
    ];
    const placeholders = new Map<string, Entity>();
    const relations = extractUserStoryRelations(entities, placeholders);
    expect(relations).toHaveLength(0);
  });
});
