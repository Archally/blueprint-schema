import type {
  ParsedBlueprintDocument,
  BlueprintModel,
  BlueprintFileMetadata,
  DocumentsBySchemaType,
  BuildModelOptions,
} from './types.js';
import { fingerprintModel } from './fingerprint.js';
import { getSchemaTypeFromPath } from '../extraction/entities/id.js';
import { extractAllEntities } from '../extraction/entities/index.js';
import { buildRelations } from '../extraction/relations/index.js';
import { mergeParties, remapRelationEndpoints } from '../extraction/entities/partyIdentity.js';
import {
  extractDomainDescriptions,
  extractRepositoryConfig,
  extractRepositoriesConfig,
} from './metadata.js';

/**
 * Group parsed documents by schema type (derived from file path).
 * Documents with unknown schema type are excluded from extraction
 * but can still contribute to metadata via the caller keeping the full list.
 *
 * Blueprint-type documents are included under the 'blueprint' key for metadata
 * extraction (repository config). Entity extractors skip them (no extractor registered).
 */
export function groupDocumentsBySchemaType(
  documents: ParsedBlueprintDocument[]
): DocumentsBySchemaType {
  const groups: DocumentsBySchemaType = {};
  for (const doc of documents) {
    const schemaType = getSchemaTypeFromPath(doc.filePath);
    if (!schemaType) continue;
    (groups[schemaType] ??= []).push(doc);
  }
  return groups;
}

/**
 * Build the internal blueprint model from documents pre-grouped by schema type.
 * Same-type documents (e.g. domain-a/concepts.yaml + domain-b/concepts.yaml) are
 * processed together so their entities end up in a single entity list.
 *
 * Deterministic by default: `metadata.last_loaded` is `null` unless the caller passes
 * `options.buildTimestamp`. This used to stamp `new Date()`, which made two builds of identical
 * source differ and quietly broke content hashes, caching and snapshot stability.
 *
 * @param documentsByType - Documents grouped by schema type (use groupDocumentsBySchemaType)
 * @param options - Build-run metadata; see BuildModelOptions. Omit for a deterministic build.
 * @returns BlueprintModel with entities (including Missing placeholders), relations, metadata
 */
export function buildBlueprintModel(
  documentsByType: DocumentsBySchemaType,
  options: BuildModelOptions = {}
): BlueprintModel {
  const allDocs = Object.values(documentsByType).flat();

  const files: BlueprintFileMetadata[] = allDocs.map((doc) => ({
    path: doc.filePath ?? '',
    schemaType: getSchemaTypeFromPath(doc.filePath) ?? undefined,
    size: undefined,
    lastModified: undefined,
  }));

  // A party is a partial class: `arch.yaml` and `organization.yaml` each declare a part, and the
  // shared `PRT###` is what makes them one node. Relations are built FIRST and their endpoints
  // rewritten after the fold — an org party owns departments and teams, so it IS an edge endpoint,
  // and folding before would drop those edges with no error. (Arch parties are not endpoints, which
  // is why the older arch-only merge could ignore this.)
  const extracted = extractAllEntities(documentsByType);
  const { relations: rawRelations, addedEntities } = buildRelations(extracted, documentsByType);
  const { entities, idRemap } = mergeParties([...extracted, ...addedEntities]);
  const relations = remapRelationEndpoints(rawRelations, idRemap);
  const domainDescriptions = extractDomainDescriptions(documentsByType);
  const repository = extractRepositoryConfig(documentsByType.blueprint);
  const repositories = extractRepositoriesConfig(documentsByType.blueprint);

  // Placeholder "Missing" entities are already part of `entities` — they were folded in above so
  // the model has one unified array (frontend renders placeholders as gray nodes).
  const allEntities = entities;

  const model: BlueprintModel = {
    entities: allEntities,
    relations,
    metadata: {
      files,
      total_entities: allEntities.length,
      total_relations: relations.length,
      last_loaded: options.buildTimestamp ?? null,
      domain_descriptions: domainDescriptions,
      ...(repository && { repository }),
      ...(repositories && { repositories }),
    },
  };

  if (options.fingerprint) {
    const fingerprintOptions = options.fingerprint === true ? {} : options.fingerprint;
    model.metadata.fingerprint = fingerprintModel(model, {
      ...fingerprintOptions,
      documentsByType: fingerprintOptions.documentsByType ?? documentsByType,
    });
  }

  return model;
}
