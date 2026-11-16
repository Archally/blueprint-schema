import { describe, expect, it } from 'vitest';
import type { Entity } from '../../model/types.js';
import { buildStoryRelations } from './story.js';

function actor(displayId = 'factory.ACT003', fileOrigin = 'factory/concepts.yaml'): Entity {
  return { id: `${fileOrigin}-${displayId}`, displayId, type: 'Actor', layer: 'design.concepts', fileOrigin, data: {} };
}

function process(data: Record<string, unknown>): Entity {
  return {
    id: 'factory-story.yaml-factory.PRC001', displayId: 'factory.PRC001', type: 'Process',
    layer: 'design.process', fileOrigin: 'factory/story.yaml', data,
  };
}

describe('process actor declarations', () => {
  it('joins a lane to its exact actor through its containing process with declaration provenance', () => {
    const source = process({ lanes: [{ actor: 'factory.ACT003' }] });
    const target = actor();

    const relations = buildStoryRelations([source, target], new Map());

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      source_entity_id: source.id, target_entity_id: target.id, type: 'process_lane_actor',
      data: { lane: 0 },
      origin_ref: { file: 'factory/story.yaml', declaration_id: 'factory.PRC001', path: expect.stringContaining('.lanes[0].actor') },
    });
  });

  it('keeps separate witnesses for a lane and each activity that names the same actor', () => {
    const source = process({
      lanes: [{ actor: 'factory.ACT003' }, { actor: 'factory.ACT003' }],
      activities: [
        { id: 'factory.PA001', triggered_by: ['factory.ACT003'] },
        { id: 'factory.PA002', triggered_by: ['factory.ACT003'] },
      ],
    });

    const relations = buildStoryRelations([source, actor()], new Map());

    expect(relations).toHaveLength(4);
    expect(new Set(relations.map(relation => relation.id)).size).toBe(4);
    expect(relations.map(relation => relation.data)).toEqual([
      { lane: 0 }, { lane: 1 }, { activity: 'factory.PA001' }, { activity: 'factory.PA002' },
    ]);
    expect(relations[2]).toMatchObject({
      type: 'activity_triggered_by_actor',
      origin_ref: { file: 'factory/story.yaml', declaration_id: 'factory.PRC001', path: expect.stringContaining('.activities[id=factory.PA001].triggered_by[0]') },
    });
  });

  it('does not treat an event trigger or extension performed_by as an actor declaration', () => {
    const source = process({ activities: [{ id: 'factory.PA001', triggered_by: ['factory.EVT001'], performed_by: 'factory.ACT003' }] });
    const event: Entity = { id: 'event', displayId: 'factory.EVT001', type: 'Operation', layer: 'design.domain', data: { kind: 'event' } };

    expect(buildStoryRelations([source, actor(), event], new Map())).toEqual([]);
  });

  it('preserves authored lane and mixed trigger positions in declaration selectors', () => {
    const source = process({
      lanes: [null, { actor: 'factory.ACT003' }],
      activities: [{ id: 'factory.PA001', triggered_by: ['factory.EVT001', 'factory.ACT003', 'factory.ACT004'] }],
    });
    const event: Entity = { id: 'event', displayId: 'factory.EVT001', type: 'Operation', layer: 'design.domain', data: { kind: 'event' } };

    const relations = buildStoryRelations([source, actor(), actor('factory.ACT004'), event], new Map());

    expect(relations).toHaveLength(3);
    expect(relations.map(relation => relation.origin_ref?.path)).toEqual([
      expect.stringContaining('.lanes[1].actor'),
      expect.stringContaining('.activities[id=factory.PA001].triggered_by[1]'),
      expect.stringContaining('.activities[id=factory.PA001].triggered_by[2]'),
    ]);
  });

  it('leaves unresolved and ambiguous references unlinked without placeholders', () => {
    const source = process({
      lanes: [{ actor: 'ACT003' }, { actor: 'factory.ACT999' }],
      activities: [{ id: 'factory.PA001', triggered_by: ['ACT003', 'factory.ACT999'] }],
    });
    const placeholders = new Map<string, Entity>();

    const relations = buildStoryRelations([source, actor('ACT003'), actor('ACT003', 'other/concepts.yaml')], placeholders);

    expect(relations).toEqual([]);
    expect(placeholders.size).toBe(0);
  });

  it('keeps namespaced declarations distinct and never matches their short tails', () => {
    const source = process({ lanes: [{ actor: 'ACT003' }], activities: [{ id: 'factory.PA001', triggered_by: ['other.ACT003'] }] });
    const target = actor('other.ACT003', 'other/concepts.yaml');

    const relations = buildStoryRelations([source, actor(), target], new Map());

    expect(relations).toHaveLength(1);
    expect(relations[0]!.target_entity_id).toBe(target.id);
  });

  it('ignores malformed declarations and leaves an unreferenced actor unlinked', () => {
    const source = process({
      lanes: [null, { actor: ['factory.ACT003'] }, { actor: '' }],
      activities: [null, { triggered_by: ['factory.ACT003'] }, { id: 'factory.PA001', triggered_by: 'factory.ACT003' }],
    });

    expect(buildStoryRelations([source, actor()], new Map())).toEqual([]);
  });
});
