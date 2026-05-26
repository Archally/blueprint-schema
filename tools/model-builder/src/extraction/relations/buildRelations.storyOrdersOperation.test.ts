import { describe, it, expect } from 'vitest';
import { buildBlueprintModel, groupDocumentsBySchemaType } from '../../model/buildModel.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

// ---------------------------------------------------------------------------
// story extraction: StoryOrdersOperation relations (step-02 TC-SE7)
// ---------------------------------------------------------------------------

const ORDERS_DOMAIN_DOC: ParsedBlueprintDocument = {
  data: {
    version: '1.0.0',
    name: 'Orders',
    operations: {
      'op.orders.submit': {
        id: 'OP001',
        kind: 'command',
        name: 'Submit Order',
        description: 'Submit draft order for confirmation',
        exchange: { protocol: 'http', endpoint: { path: '/orders/{id}/submit', method: 'POST', group: 'orders' } },
      },
    },
  },
  filePath: 'orders/domain.yaml',
  scope: 'orders',
};

const INVENTORY_DOMAIN_DOC: ParsedBlueprintDocument = {
  data: {
    version: '1.0.0',
    name: 'Inventory',
    operations: {
      'op.inventory.reserve': {
        id: 'OP001',
        kind: 'command',
        name: 'Reserve Stock',
        description: 'Reserve quantity for an order line',
        exchange: { protocol: 'http', endpoint: { path: '/inventory/reserve', method: 'POST', group: 'inventory' } },
      },
    },
  },
  filePath: 'inventory/domain.yaml',
  scope: 'inventory',
};

const ORDERS_STORY_DOC: ParsedBlueprintDocument = {
  data: {
    name: 'orders',
    version: '1.0.0',
    scope: 'orders',
    stories: [
      {
        title: 'Customer submits order',
        storyId: 'ST-001',
        operations: [
          { name: 'Add to Cart', component: 'checkout-service' },
          { name: 'Submit Order', operationRef: 'OP001', component: 'order-service' },
          { name: 'Reserve Stock', operationRef: 'inventory.OP001', component: 'inventory-service' },
          { name: 'Send confirmation email', component: 'notification-service' },
        ],
      },
    ],
  },
  filePath: 'orders/story.yaml',
  scope: 'orders',
};

describe('buildRelations / buildBlueprintModel with story extraction', () => {
  it('TC-SE7: StoryOrdersOperation relations exist for resolved operations only (2 for fixture)', () => {
    const documents: ParsedBlueprintDocument[] = [ORDERS_DOMAIN_DOC, INVENTORY_DOMAIN_DOC, ORDERS_STORY_DOC];
    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));

    const storyEntities = model.entities.filter((e) => e.type === ENTITY_TYPE.Story);
    expect(storyEntities).toHaveLength(1);

    const storyRels = model.relations.filter((r) => r.type === RELATION_TYPE.StoryOrdersOperation);
    expect(storyRels).toHaveLength(2);

    const ops = model.entities.filter((e) => e.type === ENTITY_TYPE.Operation);
    expect(ops).toHaveLength(2);
    const orderOpId = ops.find((e) => e.fileOrigin?.includes('orders/domain'))!.id;
    const invOpId = ops.find((e) => e.fileOrigin?.includes('inventory/domain'))!.id;

    const targetIds = storyRels.map((r) => r.target_entity_id).sort();
    expect(targetIds).toEqual([invOpId, orderOpId].sort());

    const story = storyEntities[0]!;
    const details = (story.data as { operationsDetail?: { resolved: boolean }[] }).operationsDetail ?? [];
    expect(details.filter((d) => d.resolved)).toHaveLength(2);
    expect(details.filter((d) => !d.resolved)).toHaveLength(2);
  });

  it('invalid operationRef: resolved false on Story and relation to Missing placeholder', () => {
    const storyWithInvalidRef: ParsedBlueprintDocument = {
      data: {
        name: 'orders',
        scope: 'orders',
        stories: [
          {
            title: 'Story with missing op ref',
            storyId: 'ST-X',
            operations: [
              { name: 'Submit Order', operationRef: 'OP001', component: 'order-service' },
              { name: 'Non-existent op', operationRef: 'orders.OP999', component: 'other' },
            ],
            },
        ],
      },
      filePath: 'orders/story.yaml',
      scope: 'orders',
    };
    const documents: ParsedBlueprintDocument[] = [ORDERS_DOMAIN_DOC, storyWithInvalidRef];
    const model = buildBlueprintModel(groupDocumentsBySchemaType(documents));

    const storyRels = model.relations.filter((r) => r.type === RELATION_TYPE.StoryOrdersOperation);
    expect(storyRels).toHaveLength(2);

    const missingTarget = storyRels.find((r) => {
      const target = model.entities.find((e) => e.id === r.target_entity_id);
      return target?.type === ENTITY_TYPE.Missing;
    });
    expect(missingTarget).toBeDefined();

    const story = model.entities.find((e) => e.type === ENTITY_TYPE.Story)!;
    const details = (story.data as { operationsDetail?: { name: string; resolved: boolean }[] }).operationsDetail ?? [];
    const nonExistent = details.find((d) => d.name === 'Non-existent op');
    expect(nonExistent!.resolved).toBe(false);
  });
});
