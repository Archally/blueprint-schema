import { describe, it, expect } from 'vitest';
import { extractStory } from './story.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

/** Document shape matching projects/ecommerce/.blueprint/v2 orders story (step 00.5 fixture). */
const ORDERS_STORY_DOC: ParsedBlueprintDocument = {
  data: {
    name: 'orders',
    version: '1.0.0',
    scope: 'orders',
    stories: [
      {
        title: 'Customer submits order',
        storyId: 'ST-001',
        description:
          'Happy path: customer places items in cart, submits order, inventory is reserved, confirmation sent.',
        operations: [
          {
            name: 'Add to Cart',
            component: 'checkout-service',
            description: 'Customer adds product to cart before order submission.',
          },
          {
            name: 'Submit Order',
            operationRef: 'OP001',
            component: 'order-service',
            description: 'Customer submits the draft order for processing.',
          },
          {
            name: 'Reserve Stock',
            operationRef: 'inventory.OP001',
            component: 'inventory-service',
            description: 'Reserve inventory for each order line item.',
          },
          {
            name: 'Send confirmation email',
            component: 'notification-service',
            description: 'Email order confirmation to customer.',
          },
        ],
      },
    ],
  },
  filePath: 'orders/story.yaml',
  scope: 'orders',
};

describe('extractStory', () => {
  it('TC-SE1: returns Story entities with type Story and layer design.story', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Story);
    expect(entities[0]!.layer).toBe('design.story');
    expect(entities[0]!.displayId).toBe('ST-001');
    expect(entities[0]!.summary).toBe('Customer submits order');
  });

  it('TC-SE2: operationsDetail has 4 entries in order with positions 0-3', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    const story = entities[0]!;
    const details = (story.data as { operationsDetail?: { position: number }[] }).operationsDetail ?? [];
    expect(details).toHaveLength(4);
    expect(details.map((d) => d.position)).toEqual([0, 1, 2, 3]);
    expect(details.map((d) => (d as { name: string }).name)).toEqual([
      'Add to Cart',
      'Submit Order',
      'Reserve Stock',
      'Send confirmation email',
    ]);
  });

  it('TC-SE3: in-scope operationRef OP001 resolves to orders-domain.yaml-OP001', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    const details = (entities[0]!.data as { operationsDetail?: { name: string; resolved: boolean; resolvedEntityId?: string }[] })
      .operationsDetail ?? [];
    const submitOrder = details.find((d) => d.name === 'Submit Order');
    expect(submitOrder).toBeDefined();
    expect(submitOrder!.resolved).toBe(true);
    expect(submitOrder!.resolvedEntityId).toBe('orders-domain.yaml-OP001');
  });

  it('TC-SE4: cross-scope operationRef inventory.OP001 resolves with full ref as primary, opId as fallback', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    const details = (entities[0]!.data as { operationsDetail?: { name: string; resolved: boolean; resolvedEntityId?: string; fallbackEntityId?: string }[] })
      .operationsDetail ?? [];
    const reserveStock = details.find((d) => d.name === 'Reserve Stock');
    expect(reserveStock).toBeDefined();
    expect(reserveStock!.resolved).toBe(true);
    // Primary: new scoped-id format
    expect(reserveStock!.resolvedEntityId).toBe('inventory-domain.yaml-inventory.OP001');
    // Fallback: old format (opId only)
    expect(reserveStock!.fallbackEntityId).toBe('inventory-domain.yaml-OP001');
  });

  it('TC-SE5: steps without operationRef have resolved false', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    const details = (entities[0]!.data as { operationsDetail?: { name: string; resolved: boolean; resolvedEntityId?: string }[] })
      .operationsDetail ?? [];
    const addToCart = details.find((d) => d.name === 'Add to Cart');
    const sendEmail = details.find((d) => d.name === 'Send confirmation email');
    expect(addToCart!.resolved).toBe(false);
    expect(addToCart!.resolvedEntityId).toBeUndefined();
    expect(sendEmail!.resolved).toBe(false);
    expect(sendEmail!.resolvedEntityId).toBeUndefined();
  });

  it('TC-SE6: scope and component available for swimlane inference', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    const story = entities[0]!;
    expect((story.data as { scope?: string }).scope).toBe('orders');
    const details = (story.data as { operationsDetail?: { name: string; component?: string }[] }).operationsDetail ?? [];
    const components = details.map((d) => d.component).filter(Boolean);
    expect(components).toEqual([
      'checkout-service',
      'order-service',
      'inventory-service',
      'notification-service',
    ]);
  });

  it('uses storyId as displayId when present', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    expect(entities[0]!.displayId).toBe('ST-001');
  });

  it('falls back to title when id and storyId absent', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'orders',
        scope: 'orders',
        stories: [{ title: 'Only story', operations: [] }],
      },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const entities = extractStory(doc);
    expect(entities[0]!.displayId).toBe('Only story');
  });

  it('falls back to story-1 when id, storyId, and title all absent', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'orders',
        scope: 'orders',
        stories: [{ operations: [] }],
      },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const entities = extractStory(doc);
    expect(entities[0]!.displayId).toBe('story-1');
  });

  it('returns empty array when data.stories is not an array', () => {
    expect(extractStory({ data: {}, filePath: 'x/story.yaml' })).toEqual([]);
    expect(extractStory({ data: { stories: null }, filePath: 'x/story.yaml' })).toEqual([]);
  });

  // v2.5: UserStory extraction
  it('v2.5: extracts UserStory entities from user_stories[]', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'orders',
        version: '1.0.0',
        scope: 'orders',
        stories: [],
        user_stories: [
          { id: 'US001', actor: 'ACT001', goal: 'place an order', benefit: 'get delivery', summary: 'Place order' },
          { id: 'US002', actor: 'ACT001', goal: 'view orders' },
        ],
      },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const entities = extractStory(doc);
    const userStories = entities.filter((e) => e.type === ENTITY_TYPE.UserStory);
    expect(userStories).toHaveLength(2);
    expect(userStories[0]!.displayId).toBe('US001');
    expect(userStories[0]!.layer).toBe('design.story');
    expect(userStories[0]!.summary).toBe('Place order');
    expect(userStories[0]!.term).toBe('place an order');
    expect(userStories[0]!.id).toBe('orders-story.yaml-US001');
    expect(userStories[1]!.displayId).toBe('US002');
    expect(userStories[1]!.summary).toBe('view orders'); // falls back to goal
  });

  it('v2.5: extracts UseCase entities from use_cases[]', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'orders',
        version: '1.0.0',
        scope: 'orders',
        stories: [],
        use_cases: [
          { id: 'UC001', name: 'Place Order', primary_actor: 'ACT001', summary: 'Full checkout' },
          { id: 'UC002', name: 'Track Order', primary_actor: 'ACT001' },
        ],
      },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const entities = extractStory(doc);
    const useCases = entities.filter((e) => e.type === ENTITY_TYPE.UseCase);
    expect(useCases).toHaveLength(2);
    expect(useCases[0]!.displayId).toBe('UC001');
    expect(useCases[0]!.layer).toBe('design.story');
    expect(useCases[0]!.summary).toBe('Full checkout');
    expect(useCases[0]!.term).toBe('Place Order');
    expect(useCases[1]!.summary).toBe('Track Order'); // falls back to name
  });

  it('v2.5: skips user_stories/use_cases items without id', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'orders',
        version: '1.0.0',
        stories: [],
        user_stories: [{ actor: 'ACT001', goal: 'no id' }, { id: 'US001', actor: 'ACT001', goal: 'has id' }],
        use_cases: [{ name: 'no id' }, { id: 'UC001', name: 'has id', primary_actor: 'ACT001' }],
      },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const entities = extractStory(doc);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.UserStory)).toHaveLength(1);
    expect(entities.filter((e) => e.type === ENTITY_TYPE.UseCase)).toHaveLength(1);
  });

  it('v2.5: stores raw data for relation resolvers', () => {
    const userStory = { id: 'US001', actor: 'ACT001', goal: 'test', operations: ['CMD001'], use_case: 'UC001' };
    const doc: ParsedBlueprintDocument = {
      data: { name: 'orders', version: '1.0.0', stories: [], user_stories: [userStory] },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const entities = extractStory(doc);
    const us = entities.find((e) => e.type === ENTITY_TYPE.UserStory);
    expect(us!.data).toBe(userStory);
  });

  it('v2.1: extracts from activities with entry_operation and steps', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        name: 'orders',
        version: '1.0.0',
        scope: 'orders',
        stories: [
          {
            title: 'Customer submits order',
            storyId: 'ST-001',
            activities: [
              {
                id: 'SA001',
                name: 'Submit Order',
                entry_operation: 'orders.CMD001',
                steps: [
                  { operation_ref: 'orders.CMD001', note: 'Validate order' },
                  { operation_ref: 'orders.EVT002', note: 'Emit event' },
                ],
              },
              {
                id: 'SA002',
                name: 'Reserve Stock',
                entry_operation: 'inventory.CMD001',
              },
            ],
          },
        ],
      },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const entities = extractStory(doc);
    expect(entities).toHaveLength(1);
    const details = (entities[0]!.data as { operationsDetail?: { name: string; operationRef?: string; resolved: boolean }[] })
      .operationsDetail ?? [];
    expect(details).toHaveLength(3);
    expect(details[0]!.name).toBe('Validate order');
    expect(details[0]!.operationRef).toBe('orders.CMD001');
    expect(details[0]!.resolved).toBe(true);
    // Cross-scope ref: primary uses full ref as displayId, fallback uses opId only
    expect((details[0] as { resolvedEntityId?: string }).resolvedEntityId).toBe('orders-domain.yaml-orders.CMD001');
    expect((details[0] as { fallbackEntityId?: string }).fallbackEntityId).toBe('orders-domain.yaml-CMD001');
    expect(details[1]!.name).toBe('Emit event');
    expect(details[1]!.operationRef).toBe('orders.EVT002');
    expect(details[2]!.name).toBe('Reserve Stock');
    expect(details[2]!.operationRef).toBe('inventory.CMD001');
    expect(details[2]!.resolved).toBe(true);
  });
});
