import type { Entity } from '../../model/types.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';
import type { ServedSchemaLine } from './ownershipDefaults.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['story']!;

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
  /** The process's status and whether the system runs it yet, as stated. Carried through, never interpreted. */
  status?: unknown;
  implementation?: unknown;
  /** The source files behind the process, as stated. Carried through, never interpreted. */
  code_refs?: unknown;
}

/**
 * Extract Story entities from a parsed story document.
 * Supports v2.0 (operations[]) and v2.1 (activities[]).
 * Each stories[] item becomes one Story entity with operationsDetail[] (ordered, with the
 * operationRef as written and scope/component for swimlane inference; the relation pass resolves
 * each ref).
 *
 * `line` is the model's schema line. It decides how a process's order is read (`deriveProcessOrder`);
 * a document read on its own is read under the newest served line, as an omitted `schemaVersion` is.
 */
export function extractStory(doc: ParsedBlueprintDocument, line: ServedSchemaLine = 'v2.8'): Entity[] {
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

    // From v2.8.10 these are direct properties; before it they were nested under `process`,
    // which after the rename would have read `process.process`. Normalized here so a consumer
    // reads one shape whichever line the model is on.
    const trigger = s.trigger ?? s.process?.trigger;
    const endStates = s.end_states ?? s.process?.end_states;
    const order =
      Array.isArray(s.activities) && s.activities.length > 0 ? deriveProcessOrder(s.activities, trigger, endStates, line) : undefined;

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
        activities: order?.activities,
        // Where the process starts and which activity reaches each end state, by the conventions
        // `deriveProcessOrder` states; derived on the v2.8 line only, so absent before it.
        ...(order?.start ? { _start: order.start } : {}),
        ...(order?.ends ? { _ends: order.ends } : {}),
        trigger,
        end_states: endStates,
        lanes: s.lanes ?? s.process?.lanes,
        // This extractor names every field it keeps, so a field it does not name is DROPPED - which
        // is why a story could declare `tracker_ref` in a valid model and no consumer could see it.
        // Carried raw: what it means and how it becomes a link are the render kit's, not this
        // module's, and a story that states none keeps the key absent rather than undefined-valued.
        tracker_ref: typeof s.tracker_ref === 'string' && s.tracker_ref.trim() ? s.tracker_ref.trim() : undefined,
        // Named here for the same reason: a field this extractor does not name is dropped. Raw and
        // trimmed; a process stating none keeps the key absent, so "not stated" stays countable.
        status: typeof s.status === 'string' && s.status.trim() ? s.status.trim() : undefined,
        implementation: typeof s.implementation === 'string' && s.implementation.trim() ? s.implementation.trim() : undefined,
        // The evidence `implementation` is read against, and the list the code reference pass turns
        // into edges to the files it names. A process stating none, or an empty list, keeps it absent.
        code_refs: Array.isArray(s.code_refs) && s.code_refs.length > 0 ? s.code_refs : undefined,
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
 *
 * Each branch carries its `origin`: `stated` for a link the model writes, `declared-order` for one
 * read from the order the activities are listed in (`deriveProcessOrder`). A consumer that needs only
 * the successors reads `to`; one that needs the difference reads `origin`.
 */
export interface NormalisedBranch {
  to: string;
  condition?: string;
  origin: BranchOrigin;
}

/** Where a successor comes from: a link the model writes, or the order its activities are listed in. */
export type BranchOrigin = 'stated' | 'declared-order';

/**
 * The activity a process starts at (`_start`): the one holding the trigger's operation
 * (`trigger-operation`), else the first listed main-path activity (`first-listed`).
 */
export interface ProcessStart {
  to: string;
  origin: 'trigger-operation' | 'first-listed';
}

/**
 * One declared end state and the activities that lead to it (`_ends`). `from` is empty where no
 * stated link and no convention attaches an activity to it. `origin` says where a non-empty `from`
 * comes from: the end state's own `from` (`stated`), or the end convention (`convention`); it is
 * absent on an end state attached to nothing.
 */
export interface ProcessEnd {
  name: string;
  type?: string;
  from: string[];
  origin?: EndOrigin;
}

/** Where an end state's attachment comes from: the model's `from`, or the end convention. */
export type EndOrigin = 'stated' | 'convention';

/** A process's activities with their derived successors, and its derived start and end attachments. */
export interface ProcessOrder {
  activities: unknown[];
  start?: ProcessStart;
  ends?: ProcessEnd[];
}

function normaliseNext(activity: Record<string, unknown>): NormalisedBranch[] | undefined {
  const declared = activity.next;
  if (Array.isArray(declared)) {
    const branches = declared
      .filter((branch): branch is Record<string, unknown> => Boolean(branch) && typeof branch === 'object')
      .map((branch): NormalisedBranch | null => {
        const to = typeof branch.to === 'string' ? branch.to : null;
        if (!to) return null;
        return typeof branch.condition === 'string' && branch.condition.length > 0 ?
            { to, condition: branch.condition, origin: 'stated' }
          : { to, origin: 'stated' };
      })
      .filter((branch): branch is NormalisedBranch => branch !== null);
    return branches.length > 0 ? branches : undefined;
  }

  const legacy = activity.next_activities;
  if (Array.isArray(legacy)) {
    const branches = legacy
      .filter((to): to is string => typeof to === 'string' && to.length > 0)
      .map((to): NormalisedBranch => ({ to, origin: 'stated' }));
    return branches.length > 0 ? branches : undefined;
  }

  return undefined;
}

type ActivityRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ActivityRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** An activity whose `path_type` is absent or `happy` is on the main path; `error` and `compensation` are not. */
function onMainPath(activity: ActivityRecord): boolean {
  return activity.path_type === undefined || activity.path_type === null || activity.path_type === '' || activity.path_type === 'happy';
}

function idOf(activity: ActivityRecord): string | undefined {
  return typeof activity.id === 'string' && activity.id.length > 0 ? activity.id : undefined;
}

/** Whether an activity runs `operation`, as its entry or as one of its steps. */
function holdsOperation(activity: ActivityRecord, operation: string): boolean {
  if (activity.entry_operation === operation) return true;
  return Array.isArray(activity.steps) && activity.steps.some((step) => isRecord(step) && step.operation_ref === operation);
}

/**
 * The order a process runs its activities in, read once, here, so every consumer reads the same one.
 *
 * On the v2.8 line, a process's activities are listed in execution order unless a main-path activity
 * states a main-path successor (`next` or `next_activities`); then the stated links are the whole
 * order. An activity whose `path_type` is `error` or `compensation` is never placed in the listed
 * order, only reached by a stated link. So in a process with no main-path link, each main-path
 * activity gets a `declared-order` successor, the next listed main-path activity, after any link it
 * states (to an off-path activity, which leaves the listed order standing).
 *
 * The start (`_start`) leads to the activity holding `trigger.operation` (as its entry or a step),
 * the first listed one where several do, else to the first listed main-path activity. In a process
 * with no main-path link, list order is its whole order, so the start leads to the first listed
 * main-path activity, and says `trigger-operation` only where that activity holds the operation.
 *
 * The end attachments (`_ends`) list every declared end state. Where any end state states `from`,
 * the stated attachments are the process's whole end routing: each end state's `from` is its own
 * list, copied as written (an id this process does not hold included, for the projection and the
 * rule to report), with `origin: stated`, and an end state that states none has an empty `from`.
 * Otherwise the end convention attaches: where exactly one has type `complete`, the last listed
 * main-path activity with no successor leads to it. Where no main-path activity is without a
 * successor, the last listed main-path activity leads to it when every successor it states is an
 * `error` or `compensation` activity: a link that leaves the main path says what happens when the
 * work goes wrong or is undone, not that the process never ends. That attachment carries
 * `origin: convention`. Every other end state, and that one where neither activity exists, has an
 * empty `from` and no `origin`.
 *
 * On v2.6 and v2.7, whose published text says nothing of list order, only the stated successors are
 * derived and neither `_start` nor `_ends` is.
 */
export function deriveProcessOrder(
  activities: unknown[],
  trigger: unknown,
  endStates: unknown,
  line: ServedSchemaLine,
): ProcessOrder {
  const successors = new Map<ActivityRecord, NormalisedBranch[]>();
  for (const activity of activities) {
    if (!isRecord(activity)) continue;
    const stated = normaliseNext(activity);
    if (stated) successors.set(activity, stated);
  }
  const withSuccessors = (): unknown[] =>
    activities.map((activity) => {
      if (!isRecord(activity)) return activity;
      const next = successors.get(activity);
      return next ? { ...activity, _next: next } : activity;
    });
  if (line !== 'v2.8') return { activities: withSuccessors() };

  const records = activities.filter(isRecord);
  const byId = new Map<string, ActivityRecord>();
  for (const activity of records) {
    const id = idOf(activity);
    if (id !== undefined) byId.set(id, activity);
  }
  const main = records.filter(onMainPath);
  const mainLinked = main.some((activity) =>
    (successors.get(activity) ?? []).some((branch) => {
      const target = byId.get(branch.to);
      return target !== undefined && onMainPath(target);
    }),
  );

  if (!mainLinked) {
    for (let index = 0; index + 1 < main.length; index++) {
      const to = idOf(main[index + 1]!);
      if (to === undefined) continue;
      const from = main[index]!;
      successors.set(from, [...(successors.get(from) ?? []), { to, origin: 'declared-order' }]);
    }
  }

  const operation = isRecord(trigger) && typeof trigger.operation === 'string' ? trigger.operation : undefined;
  const holder = operation === undefined ? undefined : records.find((activity) => holdsOperation(activity, operation) && idOf(activity) !== undefined);
  const firstMain = main.find((activity) => idOf(activity) !== undefined);
  let start: ProcessStart | undefined;
  if (!mainLinked && firstMain) {
    start = { to: idOf(firstMain)!, origin: operation !== undefined && holdsOperation(firstMain, operation) ? 'trigger-operation' : 'first-listed' };
  } else if (holder) {
    start = { to: idOf(holder)!, origin: 'trigger-operation' };
  } else if (firstMain) {
    start = { to: idOf(firstMain)!, origin: 'first-listed' };
  }

  const declaredEnds = (Array.isArray(endStates) ? endStates : [])
    .filter(isRecord)
    .filter((state): state is ActivityRecord & { name: string } => typeof state.name === 'string');
  const completes = declaredEnds.filter((state) => state.type === 'complete');
  const sinks = main.filter((activity) => idOf(activity) !== undefined && !successors.has(activity));
  const leavesMainPathOnly = (activity: ActivityRecord | undefined): activity is ActivityRecord => {
    const branches = activity === undefined ? [] : (successors.get(activity) ?? []);
    return (
      activity !== undefined &&
      idOf(activity) !== undefined &&
      branches.length > 0 &&
      branches.every((branch) => {
        const target = byId.get(branch.to);
        return target !== undefined && !onMainPath(target);
      })
    );
  };
  const lastMain = main[main.length - 1];
  const completing = sinks.length > 0 ? sinks[sinks.length - 1] : leavesMainPathOnly(lastMain) ? lastMain : undefined;
  // An end state's own `from`, read as strings only: an absent, empty or non-array `from` is not
  // stated, since the builder also reads models the schema rejects.
  const statedFrom = (state: ActivityRecord): string[] | undefined => {
    if (!Array.isArray(state.from)) return undefined;
    const ids = state.from.filter((id): id is string => typeof id === 'string' && id.length > 0);
    return ids.length > 0 ? [...new Set(ids)] : undefined;
  };
  const routesStated = declaredEnds.some((state) => statedFrom(state) !== undefined);
  const ends: ProcessEnd[] = declaredEnds.map((state) => {
    const base = { name: state.name, ...(typeof state.type === 'string' ? { type: state.type } : {}) };
    if (routesStated) {
      const from = statedFrom(state);
      return from ? { ...base, from, origin: 'stated' } : { ...base, from: [] };
    }
    return completes.length === 1 && state === completes[0] && completing ?
        { ...base, from: [idOf(completing)!], origin: 'convention' }
      : { ...base, from: [] };
  });

  return { activities: withSuccessors(), ...(start ? { start } : {}), ends };
}
