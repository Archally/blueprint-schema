/**
 * BCC relation extraction - what a bounded-context field on a BusinessDecision, Assumption or KPI
 * does and does not address.
 *
 * The suite is written around the rule rather than around a corpus count: a `scope_prefix` /
 * `context_prefix` value is a NAME and builds no edge, in either the v2.8 (`domain_scope`) or the
 * v2.6/v2.7 (`bounded_context_ref`) spelling, and only a typed BC### id resolves. The name cases
 * assert on a fixture where the name WOULD have matched a Context, since that is the only way to
 * tell "declined to resolve" apart from "found nothing".
 */
import { describe, expect, it } from 'vitest';
import { extractBccRelations } from './bcc.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function context(name: string, id = `ctx-${name}`): Entity {
  return {
    id,
    displayId: name,
    type: ENTITY_TYPE.Context,
    layer: 'design.arch',
    fileOrigin: `${name}/arch.yaml`,
    data: {},
  };
}

function canvasEntity(type: string, id: string, data: Record<string, unknown>): Entity {
  return {
    id: `e-${id}`,
    displayId: id,
    type,
    layer: 'governance.decisions',
    fileOrigin: 'orders/decisions.yaml',
    data,
  };
}

const CANVAS_TYPES = [ENTITY_TYPE.BusinessDecision, ENTITY_TYPE.Assumption, ENTITY_TYPE.KPI];

function contextLinks(entities: Entity[]) {
  return extractBccRelations(entities, new Map<string, Entity>()).filter(
    (r) => r.type === RELATION_TYPE.BoundedContextRef,
  );
}

describe('extractBccRelations - context fields', () => {
  it.each(CANVAS_TYPES)('builds no edge from domain_scope on %s, even when a Context bears that name', (type) => {
    const orders = context('orders');
    const entity = canvasEntity(type, 'X001', { domain_scope: 'orders' });
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations([orders, entity], placeholders);

    expect(relations.filter((r) => r.type === RELATION_TYPE.BoundedContextRef)).toHaveLength(0);
    expect([...placeholders.keys()]).toEqual([]);
  });

  it.each(CANVAS_TYPES)('builds no edge from a kebab-case bounded_context_ref on %s (the v2.6/v2.7 spelling is a name too)', (type) => {
    const orders = context('orders');
    const entity = canvasEntity(type, 'X900', { bounded_context_ref: 'orders' });
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations([orders, entity], placeholders);

    expect(relations.filter((r) => r.type === RELATION_TYPE.BoundedContextRef)).toHaveLength(0);
    expect([...placeholders.keys()]).toEqual([]);
  });

  it.each(CANVAS_TYPES)('resolves a typed BC### bounded_context_ref on %s', (type) => {
    const ctx = context('BC001', 'ctx-bc001');
    const entity = canvasEntity(type, 'X002', { bounded_context_ref: 'BC001' });
    const links = contextLinks([ctx, entity]);

    expect(links).toHaveLength(1);
    expect(links[0]!.source_entity_id).toBe('e-X002');
    expect(links[0]!.target_entity_id).toBe('ctx-bc001');
  });

  it('resolves a context-qualified BC### id', () => {
    const ctx: Entity = { ...context('BC001', 'ctx-shop-bc001'), displayId: 'shop.BC001' };
    const entity = canvasEntity(ENTITY_TYPE.BusinessDecision, 'X003', {
      bounded_context_ref: 'shop.BC001',
    });
    const links = contextLinks([ctx, entity]);

    expect(links).toHaveLength(1);
    expect(links[0]!.target_entity_id).toBe('ctx-shop-bc001');
  });

  it('placeholders a typed BC### id that resolves to nothing - a dangling typed ref is a real defect', () => {
    const entity = canvasEntity(ENTITY_TYPE.KPI, 'X004', { bounded_context_ref: 'BC404' });
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations([entity], placeholders);

    expect(relations.filter((r) => r.type === RELATION_TYPE.BoundedContextRef)).toHaveLength(1);
    expect([...placeholders.keys()]).toEqual(['missing-BC404']);
  });

  it('builds no edge from linked_contexts - scope_prefix, same as domain_scope', () => {
    const orders = context('orders');
    const returns = context('returns');
    const decision = canvasEntity(ENTITY_TYPE.BusinessDecision, 'BD001', {
      domain_scope: 'orders',
      linked_contexts: ['returns'],
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations([orders, returns, decision], placeholders);

    expect(
      relations.filter((r) => r.type === RELATION_TYPE.BusinessDecisionLinkedContext),
    ).toHaveLength(0);
    expect([...placeholders.keys()]).toEqual([]);
  });

  it('creates no placeholder for any name-valued context field', () => {
    const entities = [
      canvasEntity(ENTITY_TYPE.BusinessDecision, 'BD002', {
        domain_scope: 'catalog',
        linked_contexts: ['checkout', 'inventory'],
      }),
      canvasEntity(ENTITY_TYPE.Assumption, 'ASM001', { bounded_context_ref: 'customers' }),
    ];
    const placeholders = new Map<string, Entity>();
    extractBccRelations(entities, placeholders);

    expect(placeholders.size).toBe(0);
  });
});

describe('extractBccRelations - linked_user_stories', () => {
  it('resolves linked_user_stories, which IS a typed reference', () => {
    const story: Entity = {
      id: 'us-US001',
      displayId: 'US001',
      type: ENTITY_TYPE.UserStory,
      layer: 'design.story',
      fileOrigin: 'orders/story.yaml',
      data: {},
    };
    const decision = canvasEntity(ENTITY_TYPE.BusinessDecision, 'BD003', {
      linked_user_stories: ['US001'],
    });
    const relations = extractBccRelations([story, decision], new Map<string, Entity>());
    const links = relations.filter(
      (r) => r.type === RELATION_TYPE.BusinessDecisionLinkedUserStory,
    );

    expect(links).toHaveLength(1);
    expect(links[0]!.target_entity_id).toBe('us-US001');
  });

  it('reads linked_user_stories only on a BusinessDecision', () => {
    const story: Entity = {
      id: 'us-US001',
      displayId: 'US001',
      type: ENTITY_TYPE.UserStory,
      layer: 'design.story',
      fileOrigin: 'orders/story.yaml',
      data: {},
    };
    const kpi = canvasEntity(ENTITY_TYPE.KPI, 'KPI001', { linked_user_stories: ['US001'] });
    const relations = extractBccRelations([story, kpi], new Map<string, Entity>());

    expect(relations).toHaveLength(0);
  });
});
