import { describe, it, expect } from 'vitest';
import { extractValueStreamRelations } from './valueStream.js';
import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'displayId' | 'type'>): Entity {
  return {
    layer: 'governance.value-stream',
    fileOrigin: 'value-stream.yaml',
    ...overrides,
  };
}

const CAP001 = makeEntity({
  id: 'default-capability.yaml-CAP001',
  displayId: 'CAP001',
  type: ENTITY_TYPE.Capability,
  layer: 'governance.capability',
  fileOrigin: 'capability.yaml',
});

const CAP002 = makeEntity({
  id: 'default-capability.yaml-CAP002',
  displayId: 'CAP002',
  type: ENTITY_TYPE.Capability,
  layer: 'governance.capability',
  fileOrigin: 'capability.yaml',
});

const GOAL = makeEntity({
  id: 'default-motivation.yaml-GL001',
  displayId: 'GL001',
  type: ENTITY_TYPE.Goal,
  layer: 'governance.motivation',
  fileOrigin: 'motivation.yaml',
});

const KPI = makeEntity({
  id: 'default-quality.yaml-KPI001',
  displayId: 'KPI001',
  type: ENTITY_TYPE.KPI,
  layer: 'design.quality',
  fileOrigin: 'quality.yaml',
});

describe('extractValueStreamRelations', () => {
  it('extracts ValueStreamCapability from stages[].capabilities[]', () => {
    const valueStream = makeEntity({
      id: 'default-value-stream.yaml-VS001',
      displayId: 'VS001',
      type: ENTITY_TYPE.ValueStream,
      data: {
        id: 'VS001',
        name: 'Shop & Buy',
        stages: [
          { name: 'Discover', capabilities: ['CAP001', 'CAP002'] },
          { name: 'Checkout', capabilities: ['CAP001'] },
        ],
      },
    });
    const placeholders = new Map<string, Entity>();
    const allEntities = [valueStream, CAP001, CAP002];
    const relations = extractValueStreamRelations(allEntities, placeholders);

    const capRels = relations.filter((r) => r.type === RELATION_TYPE.ValueStreamCapability);
    expect(capRels).toHaveLength(3);
    expect(capRels[0]!.target_entity_id).toBe(CAP001.id);
    expect(capRels[0]!.data).toEqual({ stage: 'Discover' });
    expect(capRels[1]!.target_entity_id).toBe(CAP002.id);
    expect(capRels[2]!.target_entity_id).toBe(CAP001.id);
  });

  it('extracts ValueStreamGoal from goal_refs[]', () => {
    const valueStream = makeEntity({
      id: 'default-value-stream.yaml-VS001',
      displayId: 'VS001',
      type: ENTITY_TYPE.ValueStream,
      data: {
        id: 'VS001',
        name: 'Test',
        goal_refs: ['GL001'],
        stages: [],
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractValueStreamRelations([valueStream, GOAL], placeholders);

    const goalRels = relations.filter((r) => r.type === RELATION_TYPE.ValueStreamGoal);
    expect(goalRels).toHaveLength(1);
    expect(goalRels[0]!.target_entity_id).toBe(GOAL.id);
  });

  it('extracts ValueStreamKpi from metrics[] (flat kpi_ref array)', () => {
    const valueStream = makeEntity({
      id: 'default-value-stream.yaml-VS001',
      displayId: 'VS001',
      type: ENTITY_TYPE.ValueStream,
      data: {
        id: 'VS001',
        name: 'Test',
        metrics: ['KPI001'],
        stages: [],
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractValueStreamRelations([valueStream, KPI], placeholders);

    const kpiRels = relations.filter((r) => r.type === RELATION_TYPE.ValueStreamKpi);
    expect(kpiRels).toHaveLength(1);
    expect(kpiRels[0]!.target_entity_id).toBe(KPI.id);
  });

  it('creates placeholder for unresolvable capability ref', () => {
    const valueStream = makeEntity({
      id: 'default-value-stream.yaml-VS001',
      displayId: 'VS001',
      type: ENTITY_TYPE.ValueStream,
      data: {
        id: 'VS001',
        name: 'Test',
        stages: [{ name: 'S1', capabilities: ['CAP999'] }],
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractValueStreamRelations([valueStream], placeholders);

    expect(relations).toHaveLength(1);
    expect(placeholders.size).toBe(1);
    const placeholder = Array.from(placeholders.values())[0]!;
    expect(placeholder.type).toBe(ENTITY_TYPE.Missing);
  });

  it('extracts ValueStreamActor from primary_actors[]', () => {
    const actor = makeEntity({
      id: 'default-concepts.yaml-ACT001',
      displayId: 'ACT001',
      type: ENTITY_TYPE.Actor,
      layer: 'design.concepts',
      fileOrigin: 'concepts.yaml',
    });
    const valueStream = makeEntity({
      id: 'default-value-stream.yaml-VS001',
      displayId: 'VS001',
      type: ENTITY_TYPE.ValueStream,
      data: {
        id: 'VS001',
        name: 'Test',
        primary_actors: ['ACT001'],
        stages: [],
      },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractValueStreamRelations([valueStream, actor], placeholders);

    const actorRels = relations.filter((r) => r.type === RELATION_TYPE.ValueStreamActor);
    expect(actorRels).toHaveLength(1);
    expect(actorRels[0]!.target_entity_id).toBe(actor.id);
  });

  it('returns no relations for VS without refs', () => {
    const valueStream = makeEntity({
      id: 'default-value-stream.yaml-VS001',
      displayId: 'VS001',
      type: ENTITY_TYPE.ValueStream,
      data: { id: 'VS001', name: 'Empty', stages: [] },
    });
    const placeholders = new Map<string, Entity>();
    const relations = extractValueStreamRelations([valueStream], placeholders);
    expect(relations).toHaveLength(0);
  });
});
