/**
 * Phase 2 step-04c — BCC v5 (v2.6.3) relation extraction.
 *
 * Covers T04c-08 (BD/Assumption/KPI bounded_context_ref → Context relations
 * resolved correctly) and BD-specific linked_contexts / linked_user_stories
 * relations.
 */
import { describe, expect, it } from 'vitest';
import { extractBccRelations } from './bcc.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import type { Entity } from '../../model/types.js';

function context(name: string): Entity {
  return {
    id: `ctx-${name}`,
    displayId: name,
    type: ENTITY_TYPE.Context,
    layer: 'design.arch',
    fileOrigin: `${name}/arch.yaml`,
    data: {},
  };
}

function bd(id: string, ref: string, linked: string[] = [], linkedUS: string[] = []): Entity {
  return {
    id: `bd-${id}`,
    displayId: id,
    type: ENTITY_TYPE.BusinessDecision,
    layer: 'governance.decisions',
    fileOrigin: 'orders/decisions.yaml',
    data: {
      bounded_context_ref: ref,
      linked_contexts: linked,
      linked_user_stories: linkedUS,
    },
  };
}

function assumption(id: string, ref: string | null): Entity {
  return {
    id: `a-${id}`,
    displayId: id,
    type: ENTITY_TYPE.Assumption,
    layer: 'governance.motivation',
    fileOrigin: 'orders/motivation.yaml',
    data: ref ? { bounded_context_ref: ref } : {},
  };
}

function kpi(id: string, ref: string | null): Entity {
  return {
    id: `kpi-${id}`,
    displayId: id,
    type: ENTITY_TYPE.KPI,
    layer: 'design.quality',
    fileOrigin: 'orders/quality.yaml',
    data: ref ? { bounded_context_ref: ref } : {},
  };
}

describe('extractBccRelations', () => {
  it('emits BD → Context relations via bounded_context_ref', () => {
    const orders = context('orders');
    const decision = bd('BD001', 'orders');
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations([orders, decision], placeholders);

    const link = relations.find((r) => r.type === RELATION_TYPE.BoundedContextRef);
    expect(link).toBeDefined();
    expect(link?.source_entity_id).toBe('bd-BD001');
    expect(link?.target_entity_id).toBe('ctx-orders');
  });

  it('emits BD → Context relations for linked_contexts (cross-context policy)', () => {
    const orders = context('orders');
    const returns = context('returns');
    const decision = bd('BD001', 'orders', ['returns']);
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations(
      [orders, returns, decision],
      placeholders,
    );

    const link = relations.find(
      (r) => r.type === RELATION_TYPE.BusinessDecisionLinkedContext,
    );
    expect(link).toBeDefined();
    expect(link?.target_entity_id).toBe('ctx-returns');
  });

  it('emits Assumption → Context only when bounded_context_ref is set', () => {
    const orders = context('orders');
    const linked = assumption('A001', 'orders');
    const free = assumption('A002', null);
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations([orders, linked, free], placeholders);

    const links = relations.filter((r) => r.type === RELATION_TYPE.BoundedContextRef);
    expect(links).toHaveLength(1);
    expect(links[0]!.source_entity_id).toBe('a-A001');
  });

  it('emits KPI → Context only when bounded_context_ref is set', () => {
    const orders = context('orders');
    const linked = kpi('KPI001', 'orders');
    const free = kpi('KPI002', null);
    const placeholders = new Map<string, Entity>();
    const relations = extractBccRelations([orders, linked, free], placeholders);

    const links = relations.filter((r) => r.type === RELATION_TYPE.BoundedContextRef);
    expect(links).toHaveLength(1);
    expect(links[0]!.source_entity_id).toBe('kpi-KPI001');
  });
});
