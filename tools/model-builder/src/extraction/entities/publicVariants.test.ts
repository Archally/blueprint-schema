import { describe, it, expect } from 'vitest';
import { extractQuality } from './quality.js';
import { extractStory } from './story.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';

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

describe('public extraction compatibility', () => {
it('extracts findings using title and statement fallbacks', () => {
    const doc: ParsedBlueprintDocument = {
      data: {
        version: '1.0.0',
        findings: [
          {
            id: 'FN001',
            title: 'Checkout god-class',
            kind: 'god-class',
            severity: 'high',
            statement: 'OrderService mixes pricing, tax and shipping concerns.',
            risk_refs: ['R008'],
          },
        ],
      },
      filePath: 'checkout.findings.quality.yaml',
      scope: undefined,
    };
    const entities = extractQuality(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Finding);
    expect(entities[0]!.layer).toBe('design.quality');
    expect(entities[0]!.term).toBe('Checkout god-class');
    expect(entities[0]!.description).toBe('OrderService mixes pricing, tax and shipping concerns.');
    expect(entities[0]!.data).toMatchObject({ risk_refs: ['R008'] });
  })
it('reads the collection under `processes`, the name it carries from v2.8.10', () => {
    const { stories, ...rest } = ORDERS_STORY_DOC.data as Record<string, unknown>;
    const doc: ParsedBlueprintDocument = {
      ...ORDERS_STORY_DOC,
      data: { ...rest, processes: stories },
    };
    const entities = extractStory(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Process);
    expect(entities[0]!.displayId).toBe('ST-001');
  })
});
