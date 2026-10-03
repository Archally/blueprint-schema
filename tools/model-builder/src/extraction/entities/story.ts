import type { Entity } from '../../model/types.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['process']!;

interface StoryOperationInput {
  name?: string;
  ref?: string;
  operationRef?: string;
  component?: string;
  description?: string;
  steps?: unknown[];
}

/** v2.1 activity: id, name, entry_operation, steps? [{ operation_ref }]. */
interface StoryActivityInput {
  id?: string;
  name?: string;
  entry_operation?: string;
  steps?: Array<{ operation_ref?: string; note?: string }>;
}

/**
 * One step of a process, as the model states it.
 *
 * `operationRef` is the ref exactly as written. `resolved` and `resolvedEntityId` are written by the
 * relation pass (`relations/story.ts`), which resolves the ref against the model's entities: `true`
 * and the internal id of the one operation whose declared id is the same string, or `false` and no
 * id when the ref names nothing or names a string several operations declare. The extractor runs
 * before the entity list exists, so it records `resolved: false` and no id.
 */
export interface OperationDetail {
  name: string;
  operationRef?: string;
  resolvedEntityId?: string;
  component?: string;
  resolved: boolean;
  position: number;
}

/** Build operationsDetail from v2.1 activities (activities[].steps or [entry_operation]). */
function buildOperationsDetailFromActivities(activities: StoryActivityInput[]): OperationDetail[] {
  const result: OperationDetail[] = [];
  let position = 0;
  for (const activity of activities) {
    const activityName = activity.name ?? activity.id ?? 'Activity';
    if (activity.steps && activity.steps.length > 0) {
      for (const step of activity.steps) {
        const opRef = step.operation_ref ?? activity.entry_operation;
        result.push({
          name: (step as { note?: string }).note ?? activityName,
          operationRef: opRef,
          resolved: false,
          position: position++,
        });
      }
    } else {
      result.push({
        name: activityName,
        operationRef: activity.entry_operation,
        resolved: false,
        position: position++,
      });
    }
  }
  return result;
}

interface StoryInput {
  id?: string;
  title: string;
  storyId?: string;
  description?: string;
  initiated_by?: string[] | unknown;
  operations?: StoryOperationInput[];
  activities?: StoryActivityInput[];
  /** BPMN-style process metadata, direct properties from v2.8.10 - preserved as-is. */
  trigger?: unknown;
  end_states?: unknown;
  lanes?: unknown;
  /** The same three nested, which is how every model on an earlier schema line carries them. */
  process?: { trigger?: unknown; end_states?: unknown; lanes?: unknown };
  /** Where the work behind this story is tracked (v2.7.5). Carried through, never interpreted. */
  tracker_ref?: unknown;
}

/**
 * Extract Story entities from a parsed story document.
 * Supports v2.0 (operations[]) and v2.1 (activities[]).
 * Each stories[] item becomes one Story entity with operationsDetail[] (ordered, with the
 * operationRef as written and scope/component for swimlane inference; the relation pass resolves
 * each ref).
 */
export function extractStory(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const docScope = (doc.scope ?? data.scope) as string | undefined;
  // `stories`, `user_stories` and `use_cases` are INDEPENDENT top-level collections in
  // story.schema, so a file that declares only user stories or use cases still yields them when it
  // has no `stories` at all.
  // `processes` is the collection's name from v2.8.10; `stories` is what it was called before,
  // and every model on an earlier schema line still uses it.
  const collection = data.processes ?? data.stories;
  const stories = Array.isArray(collection) ? (collection as StoryInput[]) : [];

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i]!;
    const displayId = s.id ?? s.storyId ?? s.title ?? `story-${i + 1}`;
    const id = makeInternalId(docScope, doc.filePath, displayId);

    let operationsDetail: OperationDetail[];
    if (s.activities != null && Array.isArray(s.activities) && s.activities.length > 0) {
      operationsDetail = buildOperationsDetailFromActivities(s.activities);
    } else {
      const ops = s.operations ?? [];
      operationsDetail = ops.map((op, idx) => {
        const name = op.name ?? op.ref ?? `unnamed-${idx}`;
        return {
          name: String(name),
          operationRef: op.operationRef,
          component: op.component,
          resolved: false,
          position: idx,
        };
      });
    }

    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.Process,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: s.title,
      term: s.title,
      description: s.description,
      data: {
        title: s.title,
        storyId: s.storyId,
        description: s.description,
        initiated_by: Array.isArray(s.initiated_by) ? s.initiated_by : undefined,
        scope: docScope,
        operationsDetail,
        // Preserve raw schema structures alongside the flattened operationsDetail
        // so downstream consumers (e.g., Mermaid flowchart generator) can access
        // activity boundaries, path_type, triggered_by, next_activities and the lanes.
        // Kept as `unknown` here; downstream parses against story.schema.yaml shape.
        activities: Array.isArray(s.activities) && s.activities.length > 0 ? withNormalisedNext(s.activities) : undefined,
        // From v2.8.10 these are direct properties; before it they were nested under `process`,
        // which after the rename would have read `process.process`. Normalized here so a consumer
        // reads one shape whichever line the model is on.
        trigger: s.trigger ?? s.process?.trigger,
        end_states: s.end_states ?? s.process?.end_states,
        lanes: s.lanes ?? s.process?.lanes,
        // This extractor names every field it keeps, so a field it does not name is DROPPED - which
        // is why a story could declare `tracker_ref` in a valid model and no consumer could see it.
        // Carried raw: what it means and how it becomes a link are the render kit's, not this
        // module's, and a story that states none keeps the key absent rather than undefined-valued.
        tracker_ref: typeof s.tracker_ref === 'string' && s.tracker_ref.trim() ? s.tracker_ref.trim() : undefined,
      },
    });
  }

  // v2.5: Extract user stories from user_stories[]
  const userStories = data.user_stories as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(userStories)) {
    for (const item of userStories) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const storyId = makeInternalId(docScope, doc.filePath, displayId);
      entities.push({
        id: storyId,
        displayId,
        type: ENTITY_TYPE.UserStory,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: item.summary != null ? String(item.summary) : item.goal != null ? String(item.goal) : undefined,
        term: item.goal != null ? String(item.goal) : undefined,
        description: item.description != null ? String(item.description) : undefined,
        data: item,
      });
    }
  }

  // v2.5: Extract use cases from use_cases[]
  const useCases = data.use_cases as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(useCases)) {
    for (const item of useCases) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const displayId = String(item.id);
      const ucId = makeInternalId(docScope, doc.filePath, displayId);
      entities.push({
        id: ucId,
        displayId,
        type: ENTITY_TYPE.UseCase,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: item.summary != null ? String(item.summary) : item.name != null ? String(item.name) : undefined,
        term: item.name != null ? String(item.name) : undefined,
        description: item.description != null ? String(item.description) : undefined,
        data: item,
      });
    }
  }

  return entities;
}

/**
 * One shape for an activity's successors, whichever of the two the author wrote.
 *
 * `next[]` states a branch and the condition that takes it; `next_activities[]` states only the
 * successors. Every consumer of a process needs the same answer to "where does this go next", and
 * asking each of them to know both shapes is how two diagrams of one process come to disagree.
 *
 * The derived answer is `_next`, underscore-prefixed the way the other derived fields on raw data
 * are, so the authored keys survive verbatim beside it and a consumer can still tell what the model
 * actually says. An activity declaring both is not normal and not silently merged: `next` wins,
 * because it is the shape that can carry everything the other one can.
 */
export interface NormalisedBranch {
  to: string;
  condition?: string;
}

function normaliseNext(activity: Record<string, unknown>): NormalisedBranch[] | undefined {
  const declared = activity.next;
  if (Array.isArray(declared)) {
    const branches = declared
      .filter((branch): branch is Record<string, unknown> => Boolean(branch) && typeof branch === 'object')
      .map((branch) => {
        const to = typeof branch.to === 'string' ? branch.to : null;
        if (!to) return null;
        return typeof branch.condition === 'string' && branch.condition.length > 0 ?
            { to, condition: branch.condition }
          : { to };
      })
      .filter((branch): branch is NormalisedBranch => branch !== null);
    return branches.length > 0 ? branches : undefined;
  }

  const legacy = activity.next_activities;
  if (Array.isArray(legacy)) {
    const branches = legacy.filter((to): to is string => typeof to === 'string' && to.length > 0).map((to) => ({ to }));
    return branches.length > 0 ? branches : undefined;
  }

  return undefined;
}

function withNormalisedNext(activities: unknown[]): unknown[] {
  return activities.map((activity) => {
    if (!activity || typeof activity !== 'object') return activity;
    const next = normaliseNext(activity as Record<string, unknown>);
    return next ? { ...(activity as Record<string, unknown>), _next: next } : activity;
  });
}
