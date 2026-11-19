import { describe, it, expect } from 'vitest';
import { extractLeverageRelations } from './leverage.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'governance.leverage',
    fileOrigin: 'leverage.yaml',
    ...overrides,
  };
}

const DECISION = makeEntity({
  id: 'default-decisions.yaml-D001',
  displayId: 'D001',
  type: ENTITY_TYPE.Decision,
  layer: 'governance.decisions',
  fileOrigin: 'decisions.yaml',
});

const WORK_ITEM = makeEntity({
  id: 'default-roadmap.yaml-WI001',
  displayId: 'WI001',
  type: ENTITY_TYPE.WorkItem,
  layer: 'governance.roadmap',
  fileOrigin: 'roadmap.yaml',
});

const VALUE_STREAM = makeEntity({
  id: 'default-value-stream.yaml-VS001',
  displayId: 'VS001',
  type: ENTITY_TYPE.ValueStream,
  layer: 'governance.value-stream',
  fileOrigin: 'value-stream.yaml',
});

const CAPABILITY = makeEntity({
  id: 'default-capability.yaml-CAP003',
  displayId: 'CAP003',
  type: ENTITY_TYPE.Capability,
  layer: 'governance.capability',
  fileOrigin: 'capability.yaml',
});

function lp(id: string, data: Record<string, unknown>): Entity {
  return makeEntity({
    id: `default-leverage.yaml-${id}`,
    displayId: id,
    type: ENTITY_TYPE.LeveragePoint,
    data: { id, ...data },
  });
}

describe('extractLeverageRelations', () => {
  it('extracts one typed relation per forward ref field', () => {
    const lp001 = lp('LP001', {
      decision_refs: ['D001'],
      realized_by: ['WI001'],
      advances_value_streams: ['VS001'],
      capability_refs: ['CAP003'],
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractLeverageRelations(
      [lp001, DECISION, WORK_ITEM, VALUE_STREAM, CAPABILITY],
      placeholders
    );

    const byType = (t: string) => relations.filter((r) => r.type === t);
    expect(byType(RELATION_TYPE.LeverageDecision)).toHaveLength(1);
    expect(byType(RELATION_TYPE.LeverageDecision)[0]!.target_entity_id).toBe(DECISION.id);
    expect(byType(RELATION_TYPE.LeverageRealizedBy)[0]!.target_entity_id).toBe(WORK_ITEM.id);
    expect(byType(RELATION_TYPE.LeverageValueStream)[0]!.target_entity_id).toBe(VALUE_STREAM.id);
    expect(byType(RELATION_TYPE.LeverageCapability)[0]!.target_entity_id).toBe(CAPABILITY.id);
    // all four sourced from the leverage point
    for (const rel of relations) {
      expect(rel.source_entity_id).toBe(lp001.id);
    }
  });

  it('reads a leverage dependency from depends_on, dependent to prerequisite', () => {
    // LP003 depends_on LP001: LP001 must land before LP003 can.
    const lp001 = lp('LP001', {});
    const lp003 = lp('LP003', { depends_on: ['LP001'] });
    const placeholders = new Map<string, Entity>();
    const relations = extractLeverageRelations([lp001, lp003], placeholders);

    const dagEdges = relations.filter((r) => r.type === RELATION_TYPE.LeverageDependsOn);
    expect(dagEdges).toEqual([
      {
        id: `${lp003.id}--${RELATION_TYPE.LeverageDependsOn}--${lp001.id}`,
        source_entity_id: lp003.id,
        target_entity_id: lp001.id,
        type: RELATION_TYPE.LeverageDependsOn,
      },
    ]);
  });

  it('draws no dependency from an enables key, so an edge its target does not state is not invented', () => {
    // LP001 claims to unblock LP003, and LP003 states its own prerequisites without LP001. The
    // dependent owns the statement, so the graph carries no LP003 -> LP001 edge.
    const lp001 = lp('LP001', { enables: ['LP003'] });
    const lp003 = lp('LP003', { depends_on: [] });
    const placeholders = new Map<string, Entity>();
    const relations = extractLeverageRelations([lp001, lp003], placeholders);

    expect(relations.filter((r) => r.type === RELATION_TYPE.LeverageDependsOn)).toEqual([]);
    expect(placeholders.size).toBe(0);
  });

  it('creates a Missing placeholder for an unresolvable ref (e.g. an unmodeled fitness function)', () => {
    const lp001 = lp('LP001', { fitness_function_refs: ['FF999'] });
    const placeholders = new Map<string, Entity>();
    const relations = extractLeverageRelations([lp001], placeholders);

    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe(RELATION_TYPE.LeverageFitnessFunction);
    expect(placeholders.size).toBe(1);
    expect(Array.from(placeholders.values())[0]!.type).toBe(ENTITY_TYPE.Missing);
  });

  it('returns no relations for a leverage point with no refs', () => {
    const lp001 = lp('LP001', { title: 'Bare', one_thing: 'nothing wired' });
    const placeholders = new Map<string, Entity>();
    expect(extractLeverageRelations([lp001], placeholders)).toHaveLength(0);
  });

  it('ignores non-leverage entities', () => {
    const placeholders = new Map<string, Entity>();
    expect(extractLeverageRelations([DECISION, WORK_ITEM], placeholders)).toHaveLength(0);
  });
});

describe('watch item decision references', () => {
  const decision = makeEntity({
    id: 'default-decisions.yaml-DC007',
    displayId: 'DC007',
    type: ENTITY_TYPE.Decision,
  });
  const otherDecision = makeEntity({
    id: 'default-decisions.yaml-DC008',
    displayId: 'DC008',
    type: ENTITY_TYPE.Decision,
  });
  const watch = makeEntity({
    id: 'default-leverage.yaml-WCH001',
    displayId: 'WCH001',
    type: ENTITY_TYPE.WatchItem,
    data: { decision_refs: ['DC007', 'DC008'] },
  });

  it('resolves every decision reference as a directed watch_item_decision edge', () => {
    const placeholders = new Map<string, Entity>();
    const relations = extractLeverageRelations([watch, decision, otherDecision], placeholders);

    expect(relations).toEqual([decision, otherDecision].map((target) => ({
      id: `${watch.id}--watch_item_decision--${target.id}`,
      source_entity_id: watch.id,
      target_entity_id: target.id,
      type: 'watch_item_decision',
    })));
    expect(placeholders.size).toBe(0);
  });

  it('retains an unresolved decision as the same Missing placeholder as an unresolved risk', () => {
    const unresolvedWatch = makeEntity({
      ...watch,
      data: { risk_refs: ['DC999'], decision_refs: ['DC999'] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractLeverageRelations([unresolvedWatch], placeholders);
    const missing = [...placeholders.values()];

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ type: ENTITY_TYPE.Missing });
    expect(relations.map((relation) => [relation.type, relation.target_entity_id])).toEqual([
      ['watch_item_risk', missing[0]?.id],
      ['watch_item_decision', missing[0]?.id],
    ]);
  });

  it('exposes the watch item as the incoming endpoint of a decision reference', () => {
    const relations = extractLeverageRelations([watch, decision, otherDecision], new Map());
    const incoming = relations.filter((relation) => relation.target_entity_id === decision.id);

    expect(incoming).toEqual([{
      id: `${watch.id}--watch_item_decision--${decision.id}`,
      source_entity_id: watch.id,
      target_entity_id: decision.id,
      type: 'watch_item_decision',
    }]);
  });
});
