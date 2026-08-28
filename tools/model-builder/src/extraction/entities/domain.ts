import type { Entity } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { SCHEMA_TYPE_TO_LAYER } from '../../model/entityTypes.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { makeInternalId } from './id.js';

const LAYER = SCHEMA_TYPE_TO_LAYER['domain']!;
const QUESTION_TYPE = ENTITY_TYPE.Question;

/**
 * Normalize operations to [{op, displayId, key}, ...] for both v2.0 (map) and v2.1 (array).
 *
 * `key` is the MAP KEY, and it is carried out of here rather than discarded because it is half of a
 * ref form the schema documents: `metamodel.schema.yaml`'s `operation_ref` accepts both
 * `orders.CMD001` and `orders:placeOrder`, and the second is exactly `<domainRef>:<this key>`.
 * When `op.id` is present the key used to be dropped on the floor, which left every format-2 ref in
 * the model resolving to a Missing placeholder. Deriving it back from `name` is possible and is the
 * wrong repair - see `relations/operationRef.ts`.
 *
 * Undefined for the v2.1 array form, which has no key to carry.
 */
function iterateOperations(
  operations: unknown
): Array<{ op: Record<string, unknown>; displayId: string; key?: string }> {
  if (!operations) return [];
  if (Array.isArray(operations)) {
    return operations
      .filter((op): op is Record<string, unknown> => op != null && typeof op === 'object')
      .map((op, idx) => {
        const displayId = op.id != null ? String(op.id) : `OP${String(idx + 1).padStart(3, '0')}`;
        return { op, displayId };
      });
  }
  if (typeof operations === 'object') {
    return Object.entries(operations).map(([key, op]) => {
      const record = op != null && typeof op === 'object' ? (op as Record<string, unknown>) : {};
      const displayId = record.id != null ? String(record.id) : key;
      return { op: record, displayId, key };
    });
  }
  return [];
}

/**
 * Build a synthetic context-link payload merged into each emitted entity's
 * `data`. Phase 2 step-03 needs Operations / Errors / Questions to know
 * which BoundedContext owns them; the link comes from the file-level
 * `name:` field (the context name) and the document's `scope`.
 *
 * Underscore-prefixed keys mirror arch.ts's `_party` / `_context` /
 * `_service` convention so consumers can recognize them as
 * extractor-injected metadata, not user-authored fields.
 */
function makeContextLink(doc: ParsedBlueprintDocument): {
  _context_name?: string;
  _scope?: string;
} {
  const data = doc.data ?? {};
  const link: { _context_name?: string; _scope?: string } = {};
  const contextName = (data as Record<string, unknown>).name;
  if (typeof contextName === 'string' && contextName.length > 0) {
    link._context_name = contextName;
  }
  if (typeof doc.scope === 'string' && doc.scope.length > 0) {
    link._scope = doc.scope;
  }
  return link;
}

export function extractDomain(doc: ParsedBlueprintDocument): Entity[] {
  const entities: Entity[] = [];
  const data = doc.data ?? {};
  const contextLink = makeContextLink(doc);

  // Operations
  const operations = data.operations;
  const entries = iterateOperations(operations);
  for (const { op, displayId, key } of entries) {
    if (!op || typeof op !== 'object') continue;
    const id = makeInternalId(doc.scope, doc.filePath, displayId);
    const name = op.name != null ? String(op.name) : displayId;
    const summary = op.summary != null ? String(op.summary) : undefined;
    const description = op.description != null ? String(op.description) : undefined;
    entities.push({
      id,
      displayId,
      type: ENTITY_TYPE.Operation,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary,
      term: name,
      description,
      // `_operation_key` follows the `_context_name` / `_scope` convention: an underscore marks a
      // value the extractor injected rather than one the author wrote. It carries the dictionary key
      // so a `<domain>:<key>` operation_ref can be resolved without deriving anything.
      data: key != null ? { ...op, ...contextLink, _operation_key: key } : { ...op, ...contextLink },
    });
  }

  // Errors (v2.5)
  const errors = data.errors;
  const errorEntries = iterateOperations(errors);
  for (const { op: errorItem, displayId: errorDisplayId } of errorEntries) {
    if (!errorItem || typeof errorItem !== 'object') continue;
    const errorId = makeInternalId(doc.scope, doc.filePath, errorDisplayId);
    const errorName = errorItem.name != null ? String(errorItem.name) : errorDisplayId;
    const errorSummary = errorItem.summary != null ? String(errorItem.summary) : undefined;
    const errorDescription = errorItem.description != null ? String(errorItem.description) : undefined;
    entities.push({
      id: errorId,
      displayId: errorDisplayId,
      type: ENTITY_TYPE.Error,
      layer: LAYER,
      fileOrigin: doc.filePath,
      summary: errorSummary ?? errorName,
      term: errorName,
      description: errorDescription,
      data: { ...errorItem, ...contextLink },
    });
  }

  // Questions (v2.4)
  const questions = data.questions as Record<string, unknown>[] | undefined;
  if (Array.isArray(questions)) {
    for (const q of questions) {
      if (!q || typeof q !== 'object' || q.id == null) continue;
      const qDisplayId = String(q.id);
      const qId = makeInternalId(doc.scope, doc.filePath, qDisplayId);
      const statement = q.statement != null ? String(q.statement) : undefined;
      const qName = q.name != null ? String(q.name) : undefined;
      const qSummary = q.summary != null ? String(q.summary) : undefined;
      const qDescription = q.description != null ? String(q.description) : undefined;
      entities.push({
        id: qId,
        displayId: qDisplayId,
        type: QUESTION_TYPE,
        layer: LAYER,
        fileOrigin: doc.filePath,
        summary: qSummary ?? qName ?? statement,
        term: qName,
        description: qDescription ?? statement,
        data: { ...q, ...contextLink },
      });
    }
  }

  return entities;
}
