import type { Entity, Relation } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';
import { RELATION_TYPE } from '../../model/relationTypes.js';

/**
 * Which concepts belong to a bounded context's language.
 *
 * A concept is shared by the contexts that work with it, so the relationship is n-to-n and no single
 * field on a concept or a context can state it. The model already says which concepts each operation
 * creates or changes (`materializes[].concept`) and which concepts each competency question is about
 * (`concepts[]`), and membership already binds operations and questions to contexts (`handled_by`,
 * `scoped_to`). A context's language is the join of those edges.
 *
 * NOTHING ELSE DECIDES IT. The folder a concept file sits in, its `scope:` and the context's name are
 * layout, not statements about the model: a context declared in an arch file at the model root shared no
 * folder with any concept and received none, while a folder holding several contexts handed all of them
 * every concept it held. A concept that no operation or question names belongs to no context, and that is
 * the true answer rather than a gap to paper over.
 *
 * A reference that resolved to a placeholder rather than to a declared concept produces no edge: the
 * dangling reference is already a cross-reference finding, and an edge to a placeholder would present it
 * as a term of the context's language.
 */
export function extractContextLanguageRelations(entities: Entity[], relations: Relation[]): Relation[] {
  const conceptIds = new Set(entities.filter((e) => e.type === ENTITY_TYPE.Concept).map((e) => e.id));
  if (conceptIds.size === 0) return [];

  const contextsByOperation = new Map<string, Set<string>>();
  const contextsByQuestion = new Map<string, Set<string>>();
  const conceptsByOperation = new Map<string, Set<string>>();
  const conceptsByQuestion = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(value);
  };

  for (const relation of relations) {
    switch (relation.type) {
      case RELATION_TYPE.HandledBy:
        add(contextsByOperation, relation.source_entity_id, relation.target_entity_id);
        break;
      case RELATION_TYPE.ScopedTo:
        add(contextsByQuestion, relation.source_entity_id, relation.target_entity_id);
        break;
      case RELATION_TYPE.Materializes:
        if (conceptIds.has(relation.target_entity_id)) {
          add(conceptsByOperation, relation.source_entity_id, relation.target_entity_id);
        }
        break;
      case RELATION_TYPE.QuestionAbout:
        if (conceptIds.has(relation.target_entity_id)) {
          add(conceptsByQuestion, relation.source_entity_id, relation.target_entity_id);
        }
        break;
    }
  }

  // context -> concept -> how many operations and questions name it there
  const counts = new Map<string, Map<string, { operations: number; questions: number }>>();
  const tally = (contextId: string, conceptId: string, via: 'operations' | 'questions') => {
    let byConcept = counts.get(contextId);
    if (!byConcept) {
      byConcept = new Map();
      counts.set(contextId, byConcept);
    }
    const entry = byConcept.get(conceptId) ?? { operations: 0, questions: 0 };
    entry[via] += 1;
    byConcept.set(conceptId, entry);
  };
  for (const [operationId, concepts] of conceptsByOperation) {
    for (const contextId of contextsByOperation.get(operationId) ?? []) {
      for (const conceptId of concepts) tally(contextId, conceptId, 'operations');
    }
  }
  for (const [questionId, concepts] of conceptsByQuestion) {
    for (const contextId of contextsByQuestion.get(questionId) ?? []) {
      for (const conceptId of concepts) tally(contextId, conceptId, 'questions');
    }
  }

  const out: Relation[] = [];
  for (const [contextId, byConcept] of counts) {
    for (const [conceptId, entry] of byConcept) {
      const via: string[] = [];
      if (entry.operations > 0) via.push('operation');
      if (entry.questions > 0) via.push('question');
      out.push({
        id: `${contextId}--${RELATION_TYPE.ContextUsesConcept}--${conceptId}`,
        source_entity_id: contextId,
        target_entity_id: conceptId,
        type: RELATION_TYPE.ContextUsesConcept,
        data: { via, operation_count: entry.operations, question_count: entry.questions },
      });
    }
  }
  return out;
}
