import type { Entity } from '../../model/types.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['story']!;

/** Domain operation file basename used when resolving operationRef to entity ID. */
const DOMAIN_FILE_BASENAME = 'domain.yaml';

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

export interface OperationDetail {
  name: string;
  operationRef?: string;
  resolvedEntityId?: string;
  /** Fallback entity ID for old id format (without scope prefix). */
  fallbackEntityId?: string;
  component?: string;
  resolved: boolean;
  position: number;
}

/**
 * Resolve operationRef to the internal entity ID for a domain operation.
 * In-scope: "OP001" or "CMD001" → makeInternalId(docScope, domain.yaml, ref).
 * Cross-scope: "orders.CMD001" → tries full ref as displayId first (new scoped-id format),
 *   with fallbackId using opId only (old format).
 * Absent ref → unresolved (informational step).
 */
function resolveOperationRef(
  operationRef: string | undefined,
  docScope: string | undefined
): { resolvedEntityId?: string; fallbackEntityId?: string; resolved: boolean } {
  if (!operationRef || typeof operationRef !== 'string' || !operationRef.trim()) {
    return { resolved: false };
  }

  const dotIndex = operationRef.indexOf('.');
  if (dotIndex === -1) {
    const scope = docScope ?? 'default';
    return {
      resolvedEntityId: makeInternalId(scope, DOMAIN_FILE_BASENAME, operationRef),
      resolved: true,
    };
  }

  const targetScope = operationRef.substring(0, dotIndex);
  const opId = operationRef.substring(dotIndex + 1);
  if (!opId) return { resolved: false };

  // New format: operation id includes scope prefix (e.g. "orders.CMD001" → displayId "orders.CMD001")
  // Old format: operation id is just the local part (e.g. "CMD001" → displayId "CMD001")
  return {
    resolvedEntityId: makeInternalId(targetScope, DOMAIN_FILE_BASENAME, operationRef),
    fallbackEntityId: makeInternalId(targetScope, DOMAIN_FILE_BASENAME, opId),
    resolved: true,
  };
}

/** Build operationsDetail from v2.1 activities (activities[].steps or [entry_operation]). */
function buildOperationsDetailFromActivities(
  activities: StoryActivityInput[],
  docScope: string | undefined
): OperationDetail[] {
  const result: OperationDetail[] = [];
  let position = 0;
  for (const activity of activities) {
    const activityName = activity.name ?? activity.id ?? 'Activity';
    if (activity.steps && activity.steps.length > 0) {
      for (const step of activity.steps) {
        const opRef = step.operation_ref ?? activity.entry_operation;
        const { resolvedEntityId, fallbackEntityId, resolved } = resolveOperationRef(opRef, docScope);
        result.push({
          name: (step as { note?: string }).note ?? activityName,
          operationRef: opRef,
          resolvedEntityId,
          fallbackEntityId,
          resolved,
          position: position++,
        });
      }
    } else {
      const opRef = activity.entry_operation;
      const { resolvedEntityId, fallbackEntityId, resolved } = resolveOperationRef(opRef, docScope);
      result.push({
        name: activityName,
        operationRef: opRef,
        resolvedEntityId,
        fallbackEntityId,
        resolved,
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
  /** BPMN-style process metadata (lanes, trigger, end_states) — preserved as-is. */
  process?: unknown;
}

/**
 * Extract Story entities from a parsed story document.
 * Supports v2.0 (operations[]) and v2.1 (activities[]).
 * Each stories[] item becomes one Story entity with operationsDetail[] (ordered,
 * with operationRef resolution and scope/component for swimlane inference).
 */
export function extractStory(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const docScope = (doc.scope ?? data.scope) as string | undefined;
  const stories = data.stories as StoryInput[] | undefined;

  if (!Array.isArray(stories)) return entities;

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i]!;
    const displayId = s.id ?? s.storyId ?? s.title ?? `story-${i + 1}`;
    const id = makeInternalId(docScope, doc.filePath, displayId);

    let operationsDetail: OperationDetail[];
    if (s.activities != null && Array.isArray(s.activities) && s.activities.length > 0) {
      operationsDetail = buildOperationsDetailFromActivities(s.activities, docScope);
    } else {
      const ops = s.operations ?? [];
      operationsDetail = ops.map((op, idx) => {
        const name = op.name ?? op.ref ?? `unnamed-${idx}`;
        const { resolvedEntityId, fallbackEntityId, resolved } = resolveOperationRef(op.operationRef, docScope);
        return {
          name: String(name),
          operationRef: op.operationRef,
          resolvedEntityId,
          fallbackEntityId,
          component: op.component,
          resolved,
          position: idx,
        };
      });
    }

    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.Story,
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
        // activity boundaries, path_type, triggered_by, next_activities, and process.lanes.
        // Kept as `unknown` here; downstream parses against story.schema.yaml shape.
        activities: Array.isArray(s.activities) && s.activities.length > 0 ? s.activities : undefined,
        process: s.process,
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
