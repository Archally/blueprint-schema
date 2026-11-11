import { describe, it, expect } from 'vitest';
import { extractStory } from './story.js';
import { extractAllEntities } from './index.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { extractCodeRefRelations } from '../relations/codeRefs.js';

/** An orders story with a customer and its operations. */
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
    expect(entities[0]!.type).toBe(ENTITY_TYPE.Process);
    expect(entities[0]!.layer).toBe('design.process');
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

  it('TC-SE3: an in-scope operationRef is carried as written, unresolved until the relation pass', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    const details = (entities[0]!.data as { operationsDetail?: { name: string; operationRef?: string; resolved: boolean; resolvedEntityId?: string }[] })
      .operationsDetail ?? [];
    const submitOrder = details.find((d) => d.name === 'Submit Order');
    expect(submitOrder).toBeDefined();
    expect(submitOrder!.operationRef).toBe('OP001');
    expect(submitOrder!.resolved).toBe(false);
    expect(submitOrder!.resolvedEntityId).toBeUndefined();
  });

  it('TC-SE4: a cross-scope operationRef is carried whole, with no id built from its parts', () => {
    const entities = extractStory(ORDERS_STORY_DOC);
    const details = (entities[0]!.data as { operationsDetail?: Array<Record<string, unknown>> })
      .operationsDetail ?? [];
    const reserveStock = details.find((d) => d.name === 'Reserve Stock');
    expect(reserveStock).toBeDefined();
    expect(reserveStock!.operationRef).toBe('inventory.OP001');
    expect(reserveStock!.resolved).toBe(false);
    expect(reserveStock!.resolvedEntityId).toBeUndefined();
    expect(reserveStock!.fallbackEntityId).toBeUndefined();
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
    expect(userStories[0]!.layer).toBe('design.process');
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
    expect(useCases[0]!.layer).toBe('design.process');
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
    // Resolved by the relation pass, never here.
    expect(details[0]!.resolved).toBe(false);
    expect((details[0] as { resolvedEntityId?: string }).resolvedEntityId).toBeUndefined();
    expect((details[0] as { fallbackEntityId?: string }).fallbackEntityId).toBeUndefined();
    expect(details[1]!.name).toBe('Emit event');
    expect(details[1]!.operationRef).toBe('orders.EVT002');
    expect(details[2]!.name).toBe('Reserve Stock');
    expect(details[2]!.operationRef).toBe('inventory.CMD001');
    expect(details[2]!.resolved).toBe(false);
  });
});

/**
 * `_next` is the one shape every consumer of a process reads, derived from whichever of the two
 * successor forms the author wrote. The authored keys survive beside it untouched, because a
 * consumer that wants to know what the model SAYS, rather than where the flow goes, still can.
 */
describe('an activity states its successors in one derived shape', () => {
  function processDoc(activities: Array<Record<string, unknown>>): ParsedBlueprintDocument {
    return {
      filePath: 'orders/story.yaml',
      scope: 'orders',
      schemaType: 'story',
      data: {
        scope: 'orders',
        processes: [{ id: 'orders.PRC001', title: 'A process', activities }],
      },
    } as ParsedBlueprintDocument;
  }

  function activitiesOf(doc: ParsedBlueprintDocument) {
    const [process] = extractStory(doc);
    return (process!.data as { activities?: Array<Record<string, unknown>> }).activities ?? [];
  }

  it('derives a branch per successor from the older list', () => {
    const [activity] = activitiesOf(processDoc([{ id: 'PA001', next_activities: ['PA002', 'PA003'] }]));
    expect(activity!._next).toEqual([{ to: 'PA002', origin: 'stated' }, { to: 'PA003', origin: 'stated' }]);
    expect(activity!.next_activities).toEqual(['PA002', 'PA003']);
  });

  it('carries the condition through from the newer shape', () => {
    const [activity] = activitiesOf(
      processDoc([
        {
          id: 'PA001',
          next: [
            { to: 'PA002', condition: 'credit score >= 600' },
            { to: 'PA003' },
          ],
        },
      ])
    );
    expect(activity!._next).toEqual([
      { to: 'PA002', condition: 'credit score >= 600', origin: 'stated' },
      { to: 'PA003', origin: 'stated' },
    ]);
  });

  it('takes `next` when an activity declares both, rather than merging them', () => {
    // Declaring both is not a normal model and the schema warns on the older key. Merging two
    // statements of one fact would invent a flow neither of them describes, so the shape that can
    // carry everything the other can is the one that wins.
    const [activity] = activitiesOf(
      processDoc([{ id: 'PA001', next: [{ to: 'PA009', condition: 'x' }], next_activities: ['PA002'] }])
    );
    expect(activity!._next).toEqual([{ to: 'PA009', condition: 'x', origin: 'stated' }]);
  });

  it('carries no derived key where the activity names no successor', () => {
    // Absence has to stay absent: an empty list a consumer must tell apart from "named nothing" is
    // the shape that makes a terminal activity look like a broken one.
    for (const raw of [{ id: 'PA001' }, { id: 'PA002', next: [] }, { id: 'PA003', next_activities: [] }]) {
      const [activity] = activitiesOf(processDoc([raw]));
      expect(activity).not.toHaveProperty('_next');
    }
  });

  it('skips a branch with no destination and a successor that is not a string', () => {
    const [activity] = activitiesOf(
      processDoc([{ id: 'PA001', next: [{ condition: 'orphan' }, { to: 'PA002' }] }])
    );
    expect(activity!._next).toEqual([{ to: 'PA002', origin: 'stated' }]);

    const [legacy] = activitiesOf(processDoc([{ id: 'PA002', next_activities: [null, 'PA003'] }]));
    expect(legacy!._next).toEqual([{ to: 'PA003', origin: 'stated' }]);
  });
});

describe('a story carries where its work is tracked', () => {
  // A process retains its authored `tracker_ref` for consumers.
  function storyDoc(extra: Record<string, unknown>): ParsedBlueprintDocument {
    return {
      filePath: 'orders/story.yaml',
      scope: 'orders',
      schemaType: 'story',
      data: { scope: 'orders', processes: [{ id: 'orders.PRC001', title: 'A process', ...extra }] },
    } as ParsedBlueprintDocument;
  }
  const dataOf = (extra: Record<string, unknown>) =>
    extractStory(storyDoc(extra))[0]!.data as { tracker_ref?: unknown };

  it('carries the ref through, in every spelling the model may use', () => {
    for (const ref of ['41550', 'github:42043', 'https://github.com/PrestaShop/PrestaShop/pull/42022']) {
      expect(dataOf({ tracker_ref: ref }).tracker_ref).toBe(ref);
    }
  });

  it('trims, so a padded key still resolves against the registry', () => {
    expect(dataOf({ tracker_ref: '  41527  ' }).tracker_ref).toBe('41527');
  });

  it('leaves it undefined for a story that states none, or states something that is not a key', () => {
    // Absence has to stay absence: a renderer decides between a link and nothing on this value, and
    // an empty string would become an affordance leading nowhere.
    for (const value of [undefined, '', '   ', 42, null, { key: 'x' }]) {
      expect(dataOf({ tracker_ref: value }).tracker_ref, `tracker_ref=${String(value)}`).toBeUndefined();
    }
    expect(dataOf({}).tracker_ref).toBeUndefined();
  });
});

describe('a process carries its status and implementation as stated', () => {
  // The extractor keeps only the fields it names, so each field a consumer reads is named and tested.
  function processDoc(extra: Record<string, unknown>): ParsedBlueprintDocument {
    return {
      filePath: 'orders/story.yaml',
      scope: 'orders',
      schemaType: 'story',
      data: { scope: 'orders', processes: [{ id: 'orders.PRC001', title: 'A process', ...extra }] },
    } as ParsedBlueprintDocument;
  }
  const dataOf = (extra: Record<string, unknown>) =>
    extractStory(processDoc(extra))[0]!.data as { status?: unknown; implementation?: unknown };

  it('carries both through, trimmed', () => {
    expect(dataOf({ status: 'approved', implementation: ' as-is ' })).toMatchObject({ status: 'approved', implementation: 'as-is' });
  });

  it('leaves each undefined for a process that states none, or states something that is not a word', () => {
    for (const value of [undefined, '', '   ', 42, null, { key: 'x' }]) {
      const data = dataOf({ status: value, implementation: value });
      expect(data.status, `status=${String(value)}`).toBeUndefined();
      expect(data.implementation, `implementation=${String(value)}`).toBeUndefined();
    }
  });
});

describe('a process carries its code_refs as stated', () => {
  function processDoc(extra: Record<string, unknown>): ParsedBlueprintDocument {
    return {
      filePath: 'orders/story.yaml',
      scope: 'orders',
      schemaType: 'story',
      data: { scope: 'orders', processes: [{ id: 'orders.PRC001', title: 'A process', ...extra }] },
    } as ParsedBlueprintDocument;
  }
  const CODE_REFS = [
    { path: 'classes/PaymentModule.php', role: 'implementation', line: 12 },
    { path: 'classes/order/OrderHistory.php', role: 'implementation' },
  ];

  it('carries the list through as written, beside implementation', () => {
    const [process] = extractStory(processDoc({ implementation: 'as-is', code_refs: CODE_REFS }));
    expect(process!.data).toMatchObject({ implementation: 'as-is', code_refs: CODE_REFS });
  });

  it('gives the code reference pass an edge from the process to each file it names', () => {
    const entities = extractStory(processDoc({ code_refs: CODE_REFS }));
    const { relations, codeFileEntities } = extractCodeRefRelations(entities);

    const fromProcess = relations.filter((r) => r.type === RELATION_TYPE.CodeRef && r.source_entity_id === entities[0]!.id);
    expect(fromProcess.map((r) => (r.data as { path: string }).path)).toEqual(CODE_REFS.map((ref) => ref.path));
    expect(codeFileEntities).toHaveLength(2);
  });

  it('leaves code_refs undefined for a process that states none, an empty list or something that is not a list', () => {
    for (const value of [undefined, [], 'classes/PaymentModule.php', null, { path: 'x' }]) {
      const data = extractStory(processDoc({ code_refs: value }))[0]!.data as { code_refs?: unknown };
      expect(data.code_refs, `code_refs=${JSON.stringify(value)}`).toBeUndefined();
    }
  });
});

/**
 * The order a process runs its activities in is read once, by the builder (`deriveProcessOrder`).
 * On the v2.8 line the activities run in the order they are listed unless a main-path activity
 * states a main-path successor; an error or compensation activity is never placed in that order.
 * Each successor says where it comes from, and the process carries its start and end attachments.
 */
describe('a v2.8 process runs its activities in listed order unless it states otherwise', () => {
  type Raw = Record<string, unknown>;
  function process_(activities: Raw[], extra: Raw = {}, line?: 'v2.6' | 'v2.7' | 'v2.8'): Raw {
    const doc = {
      filePath: 'orders/story.yaml',
      scope: 'orders',
      schemaType: 'story',
      data: { scope: 'orders', processes: [{ id: 'orders.PRC001', title: 'A process', activities, ...extra }] },
    } as ParsedBlueprintDocument;
    const [entity] = line ? extractStory(doc, line) : extractStory(doc);
    return entity!.data as Raw;
  }
  const nextOf = (data: Raw) =>
    Object.fromEntries(((data.activities as Raw[]) ?? []).map((activity) => [activity.id, activity._next]));
  const happy = (id: string, extra: Raw = {}): Raw => ({ id, name: id, path_type: 'happy', ...extra });
  const order = (to: string) => ({ to, origin: 'declared-order' });
  const stated = (to: string, condition?: string) => ({ to, ...(condition ? { condition } : {}), origin: 'stated' });

  it('chains an unlinked process in list order, the last activity with no successor', () => {
    const data = process_([happy('PA001'), happy('PA002'), happy('PA003')]);
    expect(nextOf(data)).toEqual({ PA001: [order('PA002')], PA002: [order('PA003')], PA003: undefined });
  });

  it('reads an activity with no path_type as on the main path', () => {
    const data = process_([{ id: 'PA001' }, { id: 'PA002' }]);
    expect(nextOf(data)).toEqual({ PA001: [order('PA002')], PA002: undefined });
  });

  it('adds nothing to a partly linked process: one main-path link states the whole order', () => {
    const data = process_([happy('PA001', { next: [{ to: 'PA002' }] }), happy('PA002'), happy('PA003')]);
    expect(nextOf(data)).toEqual({ PA001: [stated('PA002')], PA002: undefined, PA003: undefined });
  });

  it('keeps a fully linked process exactly as stated', () => {
    const data = process_([happy('PA001', { next: [{ to: 'PA003' }] }), happy('PA002'), happy('PA003', { next: [{ to: 'PA002' }] })]);
    expect(nextOf(data)).toEqual({ PA001: [stated('PA003')], PA002: undefined, PA003: [stated('PA002')] });
  });

  it('skips error and compensation activities in the middle of the list, never chaining them', () => {
    const data = process_([
      happy('PA001'),
      { id: 'PA002', path_type: 'error' },
      happy('PA003'),
      { id: 'PA004', path_type: 'compensation' },
      { id: 'PA005' },
    ]);
    expect(nextOf(data)).toEqual({ PA001: [order('PA003')], PA002: undefined, PA003: [order('PA005')], PA004: undefined, PA005: undefined });
  });

  it('keeps the main path chained past a stated link to an error activity: an exclusive split whose listed continuation is the default flow', () => {
    const data = process_([
      happy('PA001', { next: [{ to: 'PA004', condition: 'the request is rejected' }] }),
      happy('PA002'),
      happy('PA003'),
      { id: 'PA004', path_type: 'error' },
    ]);
    const next = nextOf(data);
    expect(next.PA001).toEqual([stated('PA004', 'the request is rejected'), order('PA002')]);
    expect(next.PA002).toEqual([order('PA003')]);
    expect(next.PA003).toBeUndefined();
    expect(next.PA004).toBeUndefined();
    // No gateway is written: the continuation's origin is what marks it as the default flow.
    expect((data.activities as Raw[])[0]).not.toHaveProperty('gateway');
  });

  it('starts an unlinked process at its first listed main-path activity, even where a later one holds the trigger', () => {
    const later = process_(
      [{ id: 'PA001', path_type: 'error', entry_operation: 'orders.CMD009' }, happy('PA002', { entry_operation: 'orders.CMD001' }), happy('PA003', { entry_operation: 'orders.CMD002' })],
      { trigger: { type: 'manual', operation: 'orders.CMD002' } },
    );
    expect(later._start).toEqual({ to: 'PA002', origin: 'first-listed' });

    const first = process_([happy('PA001', { entry_operation: 'orders.CMD001' }), happy('PA002', { steps: [{ operation_ref: 'orders.CMD001' }] })], {
      trigger: { type: 'manual', operation: 'orders.CMD001' },
    });
    expect(first._start).toEqual({ to: 'PA001', origin: 'trigger-operation' });
  });

  it('starts a linked process at the first listed activity holding the trigger, as its entry or a step', () => {
    const data = process_(
      [
        happy('PA001', { entry_operation: 'orders.CMD001', next: [{ to: 'PA002' }] }),
        happy('PA002', { entry_operation: 'orders.CMD002', steps: [{ operation_ref: 'orders.CMD003' }], next: [{ to: 'PA003' }] }),
        happy('PA003', { entry_operation: 'orders.CMD003' }),
      ],
      { trigger: { type: 'message', operation: 'orders.CMD003' } },
    );
    expect(data._start).toEqual({ to: 'PA002', origin: 'trigger-operation' });

    const noHolder = process_([happy('PA001', { next: [{ to: 'PA002' }] }), happy('PA002')], { trigger: { type: 'manual' } });
    expect(noHolder._start).toEqual({ to: 'PA001', origin: 'first-listed' });
  });

  it('attaches the one complete end state to the last listed main-path sink, and nothing to the others', () => {
    const data = process_([happy('PA001'), happy('PA002')], {
      end_states: [
        { name: 'Done', type: 'complete' },
        { name: 'Failed', type: 'error' },
      ],
    });
    expect(data._ends).toEqual([
      { name: 'Done', type: 'complete', from: ['PA002'], origin: 'convention' },
      { name: 'Failed', type: 'error', from: [] },
    ]);
  });

  it('attaches the complete end to the last listed sink only, so a side sink ends its own branch', () => {
    const data = process_(
      [
        happy('PA001', { next: [{ to: 'PA002' }, { to: 'PA003' }], gateway: 'and' }),
        happy('PA002'),
        happy('PA003', { next: [{ to: 'PA004' }] }),
        happy('PA004'),
      ],
      { end_states: [{ name: 'Shipped', type: 'complete' }] },
    );
    expect(data._ends).toEqual([{ name: 'Shipped', type: 'complete', from: ['PA004'], origin: 'convention' }]);
  });

  it('attaches nothing where two end states are complete, and lists no end where none is declared', () => {
    const two = process_([happy('PA001'), happy('PA002')], {
      end_states: [
        { name: 'Paid', type: 'complete' },
        { name: 'Invoiced', type: 'complete' },
      ],
    });
    expect(two._ends).toEqual([
      { name: 'Paid', type: 'complete', from: [] },
      { name: 'Invoiced', type: 'complete', from: [] },
    ]);
    expect(process_([happy('PA001'), happy('PA002')])._ends).toEqual([]);
  });

  describe('where no main-path activity is without a successor', () => {
    const off = (id: string, pathType: 'error' | 'compensation', extra: Raw = {}): Raw => ({ id, name: id, path_type: pathType, ...extra });
    const ends = [
      { name: 'Accepted', type: 'complete' },
      { name: 'Gate cannot be made green', type: 'error' },
      { name: 'Dropped', type: 'cancel' },
    ];
    const completeFrom = (data: Raw) => ((data._ends as Raw[]).find((end) => end.type === 'complete') as Raw).from;

    it('attaches the complete end to the last listed main-path activity whose only stated link is a compensation', () => {
      // The shape of a slice-acceptance process: branches into a compensation, and the last
      // main-path activity's one stated link leads to that compensation, which loops back.
      const data = process_(
        [
          happy('PA100', { next: [{ to: 'PA101' }] }),
          happy('PA101', { next: [{ to: 'PA102', condition: 'confirmed' }, { to: 'PA105', condition: 'redirected' }] }),
          happy('PA102', { next: [{ to: 'PA103', condition: 'green' }, { to: 'PA106', condition: 'a gap' }] }),
          happy('PA103', { next: [{ to: 'PA104' }] }),
          happy('PA104', { next: [{ to: 'PA105' }] }),
          off('PA105', 'compensation', { next: [{ to: 'PA102' }] }),
          off('PA106', 'error', { next: [{ to: 'PA102' }] }),
        ],
        { end_states: ends },
      );
      expect(data._ends).toEqual([
        { name: 'Accepted', type: 'complete', from: ['PA104'], origin: 'convention' },
        { name: 'Gate cannot be made green', type: 'error', from: [] },
        { name: 'Dropped', type: 'cancel', from: [] },
      ]);
    });

    it('attaches it where the last main-path activity is listed before the error and compensation activities it does not lead to', () => {
      // The shape of a board-consolidation process: a straight main path whose gate loops through
      // an error activity, and whose last activity leads only to a compensation.
      const data = process_(
        [
          happy('PA130', { next: [{ to: 'PA131' }] }),
          happy('PA131', { next: [{ to: 'PA132', condition: 'green' }, { to: 'PA134', condition: 'a gap' }] }),
          happy('PA132', { next: [{ to: 'PA133' }] }),
          happy('PA133', { next: [{ to: 'PA135' }] }),
          off('PA134', 'error', { next: [{ to: 'PA131' }] }),
          off('PA135', 'compensation', { next: [{ to: 'PA131' }] }),
        ],
        { end_states: ends },
      );
      expect(completeFrom(data)).toEqual(['PA133']);
    });

    it('attaches it in a process with no main-path link, whose last activity states only an error link', () => {
      const data = process_([happy('PA001'), happy('PA002', { next: [{ to: 'PA003' }] }), off('PA003', 'error')], { end_states: ends });
      expect(nextOf(data)).toEqual({ PA001: [order('PA002')], PA002: [stated('PA003')], PA003: undefined });
      expect(completeFrom(data)).toEqual(['PA002']);
    });

    it('attaches nothing where the last main-path activity also states a main-path loop back', () => {
      const data = process_(
        [
          happy('PA001', { next: [{ to: 'PA002' }] }),
          happy('PA002', { next: [{ to: 'PA003', condition: 'undone' }, { to: 'PA001', condition: 'again' }] }),
          off('PA003', 'compensation', { next: [{ to: 'PA001' }] }),
        ],
        { end_states: ends },
      );
      expect(completeFrom(data)).toEqual([]);
    });

    it('attaches nothing where a stated link names no activity of the process', () => {
      const data = process_([happy('PA001', { next: [{ to: 'PA002' }] }), happy('PA002', { next: [{ to: 'PA404' }] })], { end_states: ends });
      expect(completeFrom(data)).toEqual([]);
    });

    it('keeps the last listed sink where one exists, even when the last main-path activity leaves the main path', () => {
      const data = process_(
        [
          happy('PA001', { next: [{ to: 'PA002' }, { to: 'PA003' }], gateway: 'xor' }),
          happy('PA002'),
          happy('PA003', { next: [{ to: 'PA004' }] }),
          off('PA004', 'compensation', { next: [{ to: 'PA001' }] }),
        ],
        { end_states: ends },
      );
      expect(completeFrom(data)).toEqual(['PA002']);
    });

    it('attaches nothing where two end states are complete', () => {
      const data = process_([happy('PA001', { next: [{ to: 'PA002' }] }), happy('PA002', { next: [{ to: 'PA003' }] }), off('PA003', 'compensation')], {
        end_states: [
          { name: 'Paid', type: 'complete' },
          { name: 'Invoiced', type: 'complete' },
        ],
      });
      expect(data._ends).toEqual([
        { name: 'Paid', type: 'complete', from: [] },
        { name: 'Invoiced', type: 'complete', from: [] },
      ]);
    });

    it('derives no ends for the same process on v2.7', () => {
      const data = process_([happy('PA001', { next: [{ to: 'PA002' }] }), happy('PA002', { next: [{ to: 'PA003' }] }), off('PA003', 'compensation')], { end_states: ends }, 'v2.7');
      expect(data).not.toHaveProperty('_ends');
    });
  });

  describe('where an end state states the activities that lead to it', () => {
    // The shape of an order lifecycle: a decision forks to advancing and cancelling; advancing
    // loops on itself until the order is delivered; cancelling is the only sink.
    const lifecycle = (deliveredFrom?: unknown, cancelledFrom?: unknown): Raw =>
      process_(
        [
          happy('PA005', { next: [{ to: 'PA006' }, { to: 'PA007' }], gateway: 'xor' }),
          happy('PA006', { next: [{ to: 'PA006' }] }),
          happy('PA007'),
        ],
        {
          end_states: [
            { name: 'Order Delivered', type: 'complete', ...(deliveredFrom === undefined ? {} : { from: deliveredFrom }) },
            { name: 'Order Cancelled', type: 'cancel', ...(cancelledFrom === undefined ? {} : { from: cancelledFrom }) },
          ],
        },
      );

    it('attaches each end state to the activities it names, a loop activity included, as stated', () => {
      expect(lifecycle(['PA006'], ['PA007'])._ends).toEqual([
        { name: 'Order Delivered', type: 'complete', from: ['PA006'], origin: 'stated' },
        { name: 'Order Cancelled', type: 'cancel', from: ['PA007'], origin: 'stated' },
      ]);
    });

    it('without from, the convention attaches the complete end state to the only sink', () => {
      // Without a stated route, delivery attaches to the cancel activity by convention.
      expect(lifecycle()._ends).toEqual([
        { name: 'Order Delivered', type: 'complete', from: ['PA007'], origin: 'convention' },
        { name: 'Order Cancelled', type: 'cancel', from: [] },
      ]);
    });

    it('switches the convention off for the whole process once any end state states from', () => {
      // Only the cancel route is stated: the complete end state is not attached to the last sink.
      expect(lifecycle(undefined, ['PA007'])._ends).toEqual([
        { name: 'Order Delivered', type: 'complete', from: [] },
        { name: 'Order Cancelled', type: 'cancel', from: ['PA007'], origin: 'stated' },
      ]);
    });

    it('copies an id the process does not hold as stated, for the projection and the rule to report', () => {
      expect(lifecycle(['PA404'], ['PA007'])._ends).toEqual([
        { name: 'Order Delivered', type: 'complete', from: ['PA404'], origin: 'stated' },
        { name: 'Order Cancelled', type: 'cancel', from: ['PA007'], origin: 'stated' },
      ]);
    });

    it('reads an empty, non-array or non-string from as not stated, so the convention still applies', () => {
      for (const malformed of [[], 'PA006', [42, null, '']]) {
        expect(lifecycle(malformed)._ends).toEqual([
          { name: 'Order Delivered', type: 'complete', from: ['PA007'], origin: 'convention' },
          { name: 'Order Cancelled', type: 'cancel', from: [] },
        ]);
      }
    });

    it('keeps several activities in the order the end state lists them', () => {
      expect((lifecycle(['PA007', 'PA006'])._ends as Raw[])[0]).toEqual({
        name: 'Order Delivered',
        type: 'complete',
        from: ['PA007', 'PA006'],
        origin: 'stated',
      });
    });

    it('reads no from on v2.7, where no end attachment is derived', () => {
      const doc = {
        filePath: 'orders/story.yaml',
        scope: 'orders',
        schemaType: 'story',
        data: { scope: 'orders', processes: [{ id: 'orders.PRC001', title: 'A process', activities: [happy('PA001')], end_states: [{ name: 'Done', type: 'complete', from: ['PA001'] }] }] },
      } as ParsedBlueprintDocument;
      expect(extractStory(doc, 'v2.7')[0]!.data).not.toHaveProperty('_ends');
    });
  });

  it('derives no start and no ends for a process with no activities', () => {
    const data = process_([], { end_states: [{ name: 'Done', type: 'complete' }] });
    expect(data).not.toHaveProperty('_start');
    expect(data).not.toHaveProperty('_ends');
  });

  it('keeps the stated successors only, with no start or ends, on v2.6 and v2.7', () => {
    for (const line of ['v2.6', 'v2.7'] as const) {
      const unlinked = process_([happy('PA001'), happy('PA002')], { end_states: [{ name: 'Done', type: 'complete' }] }, line);
      expect(nextOf(unlinked)).toEqual({ PA001: undefined, PA002: undefined });
      expect(unlinked).not.toHaveProperty('_start');
      expect(unlinked).not.toHaveProperty('_ends');
      const linked = process_([happy('PA001', { next_activities: ['PA002'] }), happy('PA002')], {}, line);
      expect(nextOf(linked)).toEqual({ PA001: [stated('PA002')], PA002: undefined });
    }
  });

  it('reads the schema line from the root blueprint.yaml when a whole model is built', () => {
    const model = (schemaVersion: string) =>
      extractAllEntities({
        blueprint: [{ filePath: 'blueprint.yaml', data: { name: 'Fixture', schemaVersion, domains: [] } }],
        story: [
          {
            filePath: 'orders/story.yaml',
            scope: 'orders',
            data: { scope: 'orders', stories: [{ id: 'orders.ST001', title: 'A story', activities: [happy('SA001'), happy('SA002')] }] },
          },
        ],
      } as never).find((entity) => entity.displayId === 'orders.ST001')!.data as Raw;
    expect(nextOf(model('2.7.5'))).toEqual({ SA001: undefined, SA002: undefined });
    expect(nextOf(model('2.8.73'))).toEqual({ SA001: [order('SA002')], SA002: undefined });
  });
});

describe('alternative process start attachments', () => {
  const activities = [
    { id: 'PA001', entry_operation: 'orders.CMD001', next: [{ to: 'PA003' }] },
    { id: 'PA002', entry_operation: 'orders.CMD002', next: [{ to: 'PA003' }] },
    { id: 'PA003', entry_operation: 'orders.CMD003', join: { mode: 'xor' } },
  ];
  function extracted(fields: Record<string, unknown>, line: 'v2.8' | 'v2.7' | 'v2.6' = 'v2.8') {
    const document = {
      filePath: 'orders/story.yaml',
      scope: 'orders',
      data: { processes: [{ id: 'PRC001', title: 'Alternative entries', activities, ...fields }] },
    } as ParsedBlueprintDocument;
    return extractStory(document, line)[0]!.data as Record<string, unknown>;
  }

  it('preserves distinct ordered starts and their shared continuation through node serialization', () => {
    const triggers = [
      { type: 'manual', to: 'PA001', description: 'Backend first' },
      { type: 'timer', to: 'PA002', schedule: 'P1D' },
    ];
    const data = JSON.parse(JSON.stringify(extracted({ triggers })));
    expect(data.triggers).toEqual(triggers);
    expect(data._start).toBeUndefined();
    expect(data._starts).toEqual(triggers.map((trigger, position) => ({
      id: `start-${position + 1}`,
      to: trigger.to,
      origin: 'stated',
      resolved: true,
      trigger,
    })));
    expect(data.activities.map((activity: Record<string, unknown>) => activity._next)).toEqual([
      [{ to: 'PA003', origin: 'stated' }],
      [{ to: 'PA003', origin: 'stated' }],
      undefined,
    ]);
    expect(data.activities[2].join).toEqual({ mode: 'xor' });
  });

  it('keeps two different starts at a shared target with different identities', () => {
    const data = extracted({ triggers: [{ type: 'manual', to: 'PA001' }, { type: 'timer', to: 'PA001' }] });
    expect(data._starts).toMatchObject([
      { id: 'start-1', to: 'PA001', resolved: true },
      { id: 'start-2', to: 'PA001', resolved: true },
    ]);
  });

  it.each([
    ['missing', { type: 'manual' }],
    ['malformed', { type: 'manual', to: 42 }],
    ['foreign', { type: 'manual', to: 'PA099' }],
  ])('keeps a %s target unresolved without falling back', (_name, trigger) => {
    const data = extracted({ triggers: [trigger] });
    expect(data._starts).toMatchObject([{ id: 'start-1', origin: 'stated', resolved: false }]);
    expect(data._start).toBeUndefined();
  });

  it('does not choose either activity when an exact target is declared twice', () => {
    const data = extracted({ activities: [activities[0], activities[0]], triggers: [{ type: 'manual', to: 'PA001' }] });
    expect(data._starts).toMatchObject([{ to: 'PA001', resolved: false }]);
  });

  it('does not chain plural entries when no successors are stated', () => {
    const data = extracted({
      activities: [{ id: 'PA001' }, { id: 'PA002' }],
      triggers: [{ type: 'manual', to: 'PA001' }, { type: 'timer', to: 'PA002' }],
    });
    expect(data.activities).toEqual([{ id: 'PA001' }, { id: 'PA002' }]);
  });

  it('allows an explicit error-path entry and keeps a stated cycle', () => {
    const data = extracted({
      activities: [{ id: 'PA001', path_type: 'error', next: [{ to: 'PA001' }] }],
      triggers: [{ type: 'signal', to: 'PA001' }],
    });
    expect(data._starts).toMatchObject([{ to: 'PA001', resolved: true }]);
    expect(data.activities).toMatchObject([{ _next: [{ to: 'PA001', origin: 'stated' }] }]);
  });

  it('keeps a target unresolved when no activities exist', () => {
    const data = extracted({ activities: [], triggers: [{ type: 'manual', to: 'PA001' }] });
    expect(data._starts).toMatchObject([{ to: 'PA001', resolved: false }]);
    expect(data._start).toBeUndefined();
  });

  it('normalizes a legacy trigger while retaining its singleton adapter', () => {
    const trigger = { type: 'message', operation: 'orders.CMD002' };
    const data = extracted({ trigger });
    expect(data._start).toEqual({ to: 'PA002', origin: 'trigger-operation' });
    expect(data._starts).toEqual([{ id: 'start-1', to: 'PA002', origin: 'trigger-operation', resolved: true, trigger }]);
  });

  it('retains the implied singleton when no trigger is stated', () => {
    const data = extracted({});
    expect(data._starts).toEqual([{ id: 'start-1', to: 'PA001', origin: 'first-listed', resolved: true }]);
  });

  it('has no start where neither a main activity nor a trigger is stated', () => {
    const data = extracted({ activities: [{ id: 'PA001', path_type: 'error' }] });
    expect(data._starts).toEqual([]);
    expect(data._start).toBeUndefined();
  });

  it.each(['v2.6', 'v2.7'] as const)('derives no start on %s and still preserves nested legacy metadata', (line) => {
    const trigger = { type: 'manual' };
    const data = extracted({ process: { trigger } }, line);
    expect(data.trigger).toEqual(trigger);
    expect(data._start).toBeUndefined();
    expect(data._starts).toBeUndefined();
  });
});
