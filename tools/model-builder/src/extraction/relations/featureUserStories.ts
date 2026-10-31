import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';
import { indexDeclarations, resolveReference, type RefResolution } from './refResolution.js';

export interface FeatureStoryReferenceIssue {
  featureId: string;
  reference: string;
  resolution: Exclude<RefResolution, { status: 'resolved' }>;
}

export interface FeatureStoryMismatch {
  featureId: string;
  statedOnly: string[];
  derivedOnly: string[];
}

export interface FeatureStoryComparison {
  relations: Relation[];
  candidatesByStory: Map<string, Set<string>>;
  statedByFeature: Map<string, Set<string>>;
  ownersByStory: Map<string, Set<string>>;
  referenceIssues: FeatureStoryReferenceIssue[];
  mismatches: FeatureStoryMismatch[];
}

/**
 * One comparison of exact declarations and finished operation attribution, shared by the browser
 * model and semantic adapter. No I/O, inferred authoring fields, ancestor traversal or folder bias.
 * Internal handles identify sets. Presence, including an empty list, closes fallback eligibility.
 */
export function compareFeatureUserStories(entities: Entity[], relations: Relation[]): FeatureStoryComparison {
  const features = entities.filter(entity => {
    if (entity.type !== ENTITY_TYPE.Capability) return false;
    return entity.data?.kind === 'feature';
  });
  const stories = entities.filter(entity => entity.type === ENTITY_TYPE.UserStory);
  const storyIds = new Set(stories.map(story => story.id));
  const operationIds = new Set(entities.filter(entity => entity.type === ENTITY_TYPE.Operation).map(entity => entity.id));
  const featureById = new Map(features.map(feature => [feature.id, feature]));
  const storyIndex = indexDeclarations(stories.map(story => ({
    id: typeof story.data?.id === 'string' ? story.data.id : story.displayId,
    handle: story.id,
  })));
  const statedByFeature = new Map<string, Set<string>>();
  const ownersByStory = new Map<string, Set<string>>();
  const referenceIssues: FeatureStoryReferenceIssue[] = [];
  const output = new Map<string, Relation>();

  function addEdge(featureId: string, storyId: string, origin: 'stated' | 'derived'): void {
    const id = `${featureId}--${RELATION_TYPE.FeatureUserStory}--${storyId}`;
    output.set(id, {
      id,
      source_entity_id: featureId,
      target_entity_id: storyId,
      type: RELATION_TYPE.FeatureUserStory,
      data: { origin },
    });
  }

  for (const feature of features) {
    const references = feature.data?.user_stories;
    if (!Array.isArray(references)) continue;
    const stated = new Set<string>();
    statedByFeature.set(feature.id, stated);
    for (const reference of new Set(references)) {
      if (typeof reference !== 'string') continue;
      const resolution = resolveReference(storyIndex, reference);
      if (resolution.status !== 'resolved') {
        referenceIssues.push({ featureId: feature.id, reference, resolution });
        continue;
      }
      stated.add(resolution.handle);
      const owners = ownersByStory.get(resolution.handle) ?? new Set<string>();
      owners.add(feature.id);
      ownersByStory.set(resolution.handle, owners);
      addEdge(feature.id, resolution.handle, 'stated');
    }
  }

  const featuresByOperation = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relation.type !== RELATION_TYPE.CapabilityOperation) continue;
    if (!featureById.has(relation.source_entity_id)) continue;
    if (!operationIds.has(relation.target_entity_id)) continue;
    const features = featuresByOperation.get(relation.target_entity_id) ?? new Set<string>();
    features.add(relation.source_entity_id);
    featuresByOperation.set(relation.target_entity_id, features);
  }
  const candidatesByStory = new Map(stories.map(story => [story.id, new Set<string>()]));
  const derivedByFeature = new Map(features.map(feature => [feature.id, new Set<string>()]));
  for (const relation of relations) {
    if (relation.type !== RELATION_TYPE.UserStoryOperation) continue;
    if (!storyIds.has(relation.source_entity_id)) continue;
    for (const featureId of featuresByOperation.get(relation.target_entity_id) ?? []) {
      candidatesByStory.get(relation.source_entity_id)!.add(featureId);
      derivedByFeature.get(featureId)!.add(relation.source_entity_id);
    }
  }

  for (const [storyId, candidates] of candidatesByStory) {
    if (ownersByStory.has(storyId)) continue;
    if (candidates.size !== 1) continue;
    const featureId = [...candidates][0]!;
    const feature = featureById.get(featureId)!;
    if (Object.hasOwn(feature.data ?? {}, 'user_stories')) continue;
    addEdge(featureId, storyId, 'derived');
  }

  const mismatches: FeatureStoryMismatch[] = [];
  for (const [featureId, stated] of statedByFeature) {
    const derived = derivedByFeature.get(featureId)!;
    const statedOnly = [...stated].filter(storyId => !derived.has(storyId)).sort();
    const derivedOnly = [...derived].filter(storyId => !stated.has(storyId)).sort();
    if (statedOnly.length === 0) {
      if (derivedOnly.length === 0) continue;
    }
    mismatches.push({ featureId, statedOnly, derivedOnly });
  }
  return {
    relations: [...output.values()].sort((first, second) => {
      if (first.id < second.id) return -1;
      if (first.id > second.id) return 1;
      return 0;
    }),
    candidatesByStory,
    statedByFeature,
    ownersByStory,
    referenceIssues,
    mismatches,
  };
}
