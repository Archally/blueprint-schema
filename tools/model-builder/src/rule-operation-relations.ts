/** Pure exact rule/operation/concept join shared by browser and portable projections. */
import type { Entity, Relation } from './model/types.js';
import { buildOperationKeyIndex } from './extraction/relations/operationRef.js';
import { indexDeclarations, resolveReference } from './extraction/relations/refResolution.js';

/** Structural model input; no loader, viewer or story dependencies. */
export interface RuleOperationModel {
  entities: Entity[];
  relations: Pick<Relation, 'type' | 'source_entity_id' | 'target_entity_id'>[];
}

const RULE_TYPES = ['StructuralRule', 'ClassificationRule', 'DerivationRule', 'EquivalenceRule', 'ValidationRule', 'TransitionRule'];
const GUARD_FIELDS = ['governed_by', 'preconditions', 'postconditions'];

function dataOf(entity: Entity): Record<string, unknown> {
  return entity.data ?? {};
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function strs(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function objects(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = data[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object') : [];
}

function declarationsOf(entities: Entity[], types: readonly string[]) {
  return indexDeclarations(entities.filter((entity) => types.includes(entity.type))
    .map((entity) => ({ id: entity.displayId, handle: entity.id })));
}

export interface ModelRelationshipReference {
  ref: string;
  status: 'resolved' | 'unresolved' | 'ambiguous' | 'absent';
  id: string | null;
  displayId: string | null;
  name: string | null;
  kind: string | null;
  sourceFile: string | null;
  contextIds: string[];
}

export interface RuleGuardReference {
  relationship: string;
  description: string | null;
  rule: ModelRelationshipReference;
}

/**
 * One authored example of a rule: an input and what the rule makes of it, with an optional note. Every side is
 * optional, as the schema states it; a side that is absent or blank is left out rather than filled in.
 */
export interface RuleExample {
  input?: string;
  output?: string;
  note?: string;
}

const EXAMPLE_SIDES = ['input', 'output', 'note'] as const;

/**
 * A rule's `examples`, in authored order. Each entry keeps the sides it states as authored text; an entry that
 * states none of them, or is not a mapping, is not an example and is left out. A rule kind whose schema has no
 * `examples` field states none, so it reads as an empty list.
 */
export function ruleExamples(data: Record<string, unknown>): RuleExample[] {
  const examples: RuleExample[] = [];
  for (const entry of objects(data, 'examples')) {
    const example: RuleExample = {};
    for (const side of EXAMPLE_SIDES) {
      const text = str(entry, side);
      if (text !== undefined) {
        example[side] = text;
      }
    }
    if (Object.keys(example).length > 0) {
      examples.push(example);
    }
  }
  return examples;
}

export interface ModelRuleReading {
  id: string;
  displayId: string;
  name: string;
  kind: string;
  summary: string | null;
  description: string | null;
  logic: unknown;
  fact: string | null;
  modality: string | null;
  rationale: string | null;
  /**
   * The rule's authored examples, in order (see `ruleExamples`); an empty list when it states none. Optional so a
   * reading serialised before the field existed still reads; such a reading states no examples.
   */
  examples?: RuleExample[];
  from: string | null;
  to: string | null;
  guard: unknown;
  ownedBy: unknown;
  sourceFile: string | null;
  /** Contexts explicitly reached through guarded operations or constrained concepts. Not ownership. */
  contextIds: string[];
  concepts: ModelRelationshipReference[];
  operations: Array<{ relationship: string; description: string | null; operation: ModelRelationshipReference }>;
}

export function projectRuleOperationRelations(model: RuleOperationModel): {
  rules: ModelRuleReading[];
  guardsByOperation: Map<string, RuleGuardReference[]>;
} {
  const contextsBySubject = new Map<string, string[]>();
  for (const relation of model.relations) {
    let subject: string;
    let context: string;
    if (relation.type === 'handled_by') {
      subject = relation.source_entity_id;
      context = relation.target_entity_id;
    } else if (relation.type === 'context_uses_concept') {
      subject = relation.target_entity_id;
      context = relation.source_entity_id;
    } else {
      continue;
    }
    const contexts = contextsBySubject.get(subject) ?? [];
    if (!contexts.includes(context)) {
      contexts.push(context);
    }
    contextsBySubject.set(subject, contexts);
  }
  const operationIndex = declarationsOf(model.entities, ['Operation']);
  const operationKeys = buildOperationKeyIndex(model.entities);
  const entitiesById = new Map(model.entities.map((entity) => [entity.id, entity]));
  const ruleIndex = declarationsOf(model.entities, RULE_TYPES);
  const conceptIndex = declarationsOf(model.entities, ['Concept']);
  const reference = (index: ReturnType<typeof declarationsOf>, ref?: string): ModelRelationshipReference => {
    const answer = ref === undefined ? undefined : resolveReference(index, ref);
    const entity = answer?.status === 'resolved' ? entitiesById.get(answer.handle) : undefined;
    const data = entity ? dataOf(entity) : {};
    return {
      ref: ref ?? '',
      status: answer?.status ?? 'absent',
      id: entity?.id ?? null,
      displayId: entity?.displayId ?? null,
      name: str(data, 'name') ?? entity?.term ?? null,
      kind: str(data, 'kind') ?? null,
      sourceFile: entity?.fileOrigin ?? null,
      contextIds: entity ? [...(contextsBySubject.get(entity.id) ?? [])].sort() : [],
    };
  };
  const operationReference = (ref?: string): ModelRelationshipReference => {
    const key = ref === undefined ? undefined : operationKeys.get(ref);
    if (key === null) {
      return { ...reference(indexDeclarations([]), ref), status: 'ambiguous' };
    }
    const entity = key === undefined ? undefined : entitiesById.get(key);
    const resolved = reference(operationIndex, entity?.displayId ?? ref);
    return { ...resolved, ref: ref ?? '' };
  };
  const guardsByOperation = new Map<string, RuleGuardReference[]>();
  const operationsByRule = new Map<string, ModelRuleReading['operations']>();
  for (const operation of model.entities.filter((entity) => entity.type === 'Operation')) {
    const guards: RuleGuardReference[] = [];
    for (const relationship of GUARD_FIELDS) {
      for (const entry of objects(dataOf(operation), relationship)) {
        const rule = reference(ruleIndex, str(entry, 'rule'));
        const description = str(entry, 'description') ?? null;
        guards.push({ relationship, description, rule });
        if (rule.id === null) {
          continue;
        }
        const operations = operationsByRule.get(rule.id) ?? [];
        operations.push({ relationship, description, operation: operationReference(operation.displayId) });
        operationsByRule.set(rule.id, operations);
      }
    }
    guardsByOperation.set(operation.id, guards);
  }
  const rules = model.entities.filter((entity) => RULE_TYPES.includes(entity.type)).map((entity): ModelRuleReading => {
    const data = dataOf(entity);
    const operations = operationsByRule.get(entity.id) ?? [];
    const contextIds = new Set(operations.flatMap((entry) => entry.operation.contextIds));
    const concept = str(data, 'concept');
    const conceptRefs = [...(strs(data, 'concepts') ?? []), ...(concept === undefined ? [] : [concept])];
    const concepts = conceptRefs.map((ref) => reference(conceptIndex, ref));
    for (const conceptReference of concepts) {
      for (const context of conceptReference.contextIds) {
        contextIds.add(context);
      }
    }
    return {
      id: entity.id,
      displayId: entity.displayId,
      name: str(data, 'name') ?? entity.term ?? entity.displayId,
      kind: entity.type.replace(/Rule$/, '').toLowerCase(),
      summary: str(data, 'summary') ?? entity.summary ?? null,
      description: str(data, 'description') ?? entity.description ?? null,
      logic: data.logic ?? null,
      fact: str(data, 'fact') ?? null,
      modality: str(data, 'modality') ?? null,
      rationale: str(data, 'rationale') ?? null,
      examples: ruleExamples(data),
      from: str(data, 'from') ?? null,
      to: str(data, 'to') ?? null,
      guard: data.guard ?? null,
      ownedBy: data.owned_by ?? null,
      sourceFile: entity.fileOrigin ?? null,
      contextIds: [...contextIds].sort(),
      concepts,
      operations,
    };
  });
  return { rules, guardsByOperation };
}

export interface RuleStatementLine {
  field: string;
  text: string;
}

const LOGIC_ORDER = ['when', 'then', 'else'];

function textOf(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value == null) {
    return null;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  return typeof value === 'object';
}

/**
 * The rule's authored statement: `fact`, the `logic` clauses (`when`, `then`, `else`, then any other key in name
 * order), the transition (`from` and `to`), its `guard`, and the `rationale`.
 */
export function ruleStatementLines(rule: Pick<ModelRuleReading, 'fact' | 'logic' | 'from' | 'to' | 'guard' | 'rationale'>): RuleStatementLine[] {
  const lines: RuleStatementLine[] = [];
  const push = (field: string, value: unknown) => {
    const text = textOf(value);
    if (text !== null) {
      lines.push({ field, text });
    }
  };
  push('fact', rule.fact);
  const logic = rule.logic;
  if (isRecord(logic)) {
    const keys = Object.keys(logic);
    const ordered = [
      ...LOGIC_ORDER.filter((key) => keys.includes(key)),
      ...keys.filter((key) => !LOGIC_ORDER.includes(key)).sort(),
    ];
    for (const key of ordered) {
      push(key, logic[key]);
    }
  } else {
    push('logic', logic);
  }
  const transitionStated = rule.from !== null
    || rule.to !== null;
  if (transitionStated) {
    push('transition', `${rule.from ?? 'not stated'} → ${rule.to ?? 'not stated'}`);
  }
  const guard = rule.guard;
  if (isRecord(guard)) {
    for (const key of Object.keys(guard).sort()) {
      push(`guard ${key}`, guard[key]);
    }
  } else {
    push('guard', guard);
  }
  push('rationale', rule.rationale);
  return lines;
}

