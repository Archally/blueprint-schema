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

  it('normalizes the LP DAG: depends_on and the inverse of enables collapse to one edge', () => {
    // LP001 enables LP003; LP003 depends_on LP001 — the SAME dependency edge from both sides.
    const lp001 = lp('LP001', { enables: ['LP003'] });
    const lp003 = lp('LP003', { depends_on: ['LP001'] });
    const placeholders = new Map<string, Entity>();
    const relations = extractLeverageRelations([lp001, lp003], placeholders);

    const dagEdges = relations.filter((r) => r.type === RELATION_TYPE.LeverageDependsOn);
    // Both declarations produce id `${LP003}--leverage_depends_on--${LP001}` → the extractor
    // returns two entries with the same id; buildRelations() dedups them. Assert the direction.
    expect(dagEdges.length).toBeGreaterThanOrEqual(1);
    for (const edge of dagEdges) {
      expect(edge.source_entity_id).toBe(lp003.id); // dependent
      expect(edge.target_entity_id).toBe(lp001.id); // prerequisite
      expect(edge.id).toBe(`${lp003.id}--${RELATION_TYPE.LeverageDependsOn}--${lp001.id}`);
    }
    // identical ids → a Set collapses them (mirrors buildRelations dedup)
    expect(new Set(dagEdges.map((edge) => edge.id)).size).toBe(1);
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
