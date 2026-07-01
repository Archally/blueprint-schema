import type { Entity, Relation, DocumentsBySchemaType } from '../../model/types.js';
import { extractConceptRelations } from './concepts.js';
import { extractRuleRelations } from './rules.js';
import { extractDomainRelations } from './domain.js';
import { extractPayloadModelRelations } from './payloadModel.js';
import { extractDecisionRelations } from './decisions.js';
import { extractTestCaseRelations } from './testCases.js';
import { extractArchRelations } from './arch.js';
import { extractArchContractRelations } from './archContracts.js';
import { extractArchDependencyRelations } from './archDependencies.js';
import { buildStoryRelations } from './story.js';
import { extractOrgRelations } from './org.js';
import { extractUIRelations } from './ui.js';
import { extractQuestionRelations } from './questions.js';
import { extractCodeRefRelations } from './codeRefs.js';
import { extractExampleValidatesRelations } from './exampleValidates.js';
import { extractUserStoryRelations } from './userStory.js';
import { extractUseCaseRelations } from './useCase.js';
import { extractRoadmapRelations } from './roadmap.js';
import { extractMotivationRelations } from './motivation.js';
import { extractInquiryRelations } from './inquiry.js';
import { extractCapabilityRelations } from './capability.js';
import { extractValueStreamRelations } from './valueStream.js';
import { extractBccRelations } from './bcc.js';
import { extractRgRelations } from './rg.js';

/**
 * Build all relations from the entity list.
 *
 * For unresolvable references (target entity not in the model), creates placeholder
 * "Missing" entities and relations pointing to them. Frontend renders these as gray
 * nodes ("out of scope" or "missing").
 *
 * @param entities - All entities extracted in step-03
 * @param _documentsByType - Reserved for future extractors that need raw document data
 * @returns { relations, addedEntities } — caller merges addedEntities (placeholders) into
 *          the main entity list so the final model has one unified entities array.
 */
export function buildRelations(
  entities: Entity[],
  _documentsByType: DocumentsBySchemaType
): { relations: Relation[]; addedEntities: Entity[] } {
  // Shared placeholder registry: same unresolvable ref → same Missing entity
  const placeholders = new Map<string, Entity>();

  // code_ref extraction produces both relations and synthetic CodeFile entities
  const { relations: codeRefRelations, codeFileEntities } = extractCodeRefRelations(entities);

  const allRelations: Relation[] = [
    ...extractConceptRelations(entities, placeholders),
    ...extractRuleRelations(entities, placeholders),
    ...extractDomainRelations(entities, placeholders),
    ...extractPayloadModelRelations(entities, placeholders),
    ...extractDecisionRelations(entities, placeholders),
    ...extractTestCaseRelations(entities, placeholders),
    ...extractArchRelations(entities),
    ...extractArchContractRelations(entities, placeholders),
    ...extractArchDependencyRelations(entities, placeholders),
    ...buildStoryRelations(entities, placeholders),
    ...extractOrgRelations(entities),
    ...extractUIRelations(entities, placeholders),
    ...extractQuestionRelations(entities, placeholders),
    ...extractExampleValidatesRelations(entities, placeholders),
    ...extractUserStoryRelations(entities, placeholders),
    ...extractUseCaseRelations(entities, placeholders),
    ...extractRoadmapRelations(entities, placeholders),
    ...extractMotivationRelations(entities, placeholders),
    ...extractInquiryRelations(entities, placeholders),
    ...extractCapabilityRelations(entities, placeholders),
    ...extractValueStreamRelations(entities, placeholders),
    ...extractBccRelations(entities, placeholders),
    ...extractRgRelations(entities),
    ...codeRefRelations,
  ];

  // Deduplicate by relation id (guards against identical refs in same collection)
  const seen = new Set<string>();
  const relations = allRelations.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  return {
    relations,
    addedEntities: [...Array.from(placeholders.values()), ...codeFileEntities],
  };
}
