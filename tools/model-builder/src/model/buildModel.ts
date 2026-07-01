import type {
  ParsedBlueprintDocument,
  BlueprintModel,
  BlueprintFileMetadata,
  DocumentsBySchemaType,
  RepositoryConfig,
} from './types.js';
import { getSchemaTypeFromPath } from '../extraction/entities/id.js';
import { extractAllEntities } from '../extraction/entities/index.js';
import { buildRelations } from '../extraction/relations/index.js';
import { ENTITY_TYPE } from './entityTypes.js';
import type { Entity } from './types.js';

/**
 * Merge Party entities that share the same (scope, name) across multiple arch files.
 *
 * A root context map may be split into several `*.arch.yaml` files, each of which must
 * re-declare its `parties: [{ name, env, contexts }]` wrapper to be schema-valid. The arch
 * extractor emits one Party entity per file (its id is file-scoped), so the same party would
 * otherwise appear N times. Collapse them into the first occurrence, unioning their
 * `data.contexts` (by context name). Context/Service/Contract entities are emitted separately
 * and are unaffected; no relation builder resolves against Party, so this is purely de-duplication.
 */
function mergeArchParties(entities: Entity[]): Entity[] {
  const byKey = new Map<string, Entity>();
  const result: Entity[] = [];
  for (const entity of entities) {
    if (entity.type !== ENTITY_TYPE.Party) {
      result.push(entity);
      continue;
    }
    const scope = (entity.data?._scope as string | undefined) ?? '';
    const key = `${scope}::${entity.displayId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entity);
      result.push(entity);
      continue;
    }
    // Fold this party's contexts into the first one; drop the duplicate Party entity.
    const target = (existing.data ??= {});
    const existingContexts = Array.isArray(target.contexts) ? (target.contexts as unknown[]) : [];
    const incoming = Array.isArray(entity.data?.contexts) ? (entity.data!.contexts as unknown[]) : [];
    const seen = new Set(
      existingContexts.map((c) => (c as { name?: string } | null)?.name).filter(Boolean)
    );
    for (const ctx of incoming) {
      const name = (ctx as { name?: string } | null)?.name;
      if (name && !seen.has(name)) {
        existingContexts.push(ctx);
        seen.add(name);
      }
    }
    target.contexts = existingContexts;
  }
  return result;
}

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
 * @param documentsByType - Documents grouped by schema type (use groupDocumentsBySchemaType)
 * @returns BlueprintModel with entities (including Missing placeholders), relations, metadata
 */
export function buildBlueprintModel(documentsByType: DocumentsBySchemaType): BlueprintModel {
  const allDocs = Object.values(documentsByType).flat();

  const files: BlueprintFileMetadata[] = allDocs.map((doc) => ({
    path: doc.filePath ?? '',
    schemaType: getSchemaTypeFromPath(doc.filePath) ?? undefined,
    size: undefined,
    lastModified: undefined,
  }));

  const entities = mergeArchParties(extractAllEntities(documentsByType));
  const { relations, addedEntities } = buildRelations(entities, documentsByType);
  const domainDescriptions = extractDomainDescriptions(documentsByType);
  const repository = extractRepositoryConfig(documentsByType.blueprint);
  const repositories = extractRepositoriesConfig(documentsByType.blueprint);

  // Merge placeholder "Missing" entities into the entity list so the model
  // has one unified array (frontend renders placeholders as gray nodes).
  const allEntities = [...entities, ...addedEntities];

  return {
    entities: allEntities,
    relations,
    metadata: {
      files,
      total_entities: allEntities.length,
      total_relations: relations.length,
      last_loaded: new Date().toISOString(),
      domain_descriptions: domainDescriptions,
      ...(repository && { repository }),
      ...(repositories && { repositories }),
    },
  };
}

function inferDomainFromPath(path: string | undefined): string {
  if (!path) return 'Global';
  const normalized = path.replace(/\\/g, '/');
  const seg = normalized.split('/').filter(Boolean)[0];
  if (!seg || seg === '.' || seg === '..') return 'Global';
  if (seg === 'default') return 'Global';
  return seg;
}

function extractDomainDescriptions(
  documentsByType: DocumentsBySchemaType
): Record<string, string> {
  const domainDocs = documentsByType.domain ?? [];
  if (domainDocs.length === 0) return {};

  const rows = domainDocs
    .map((doc) => {
      const raw = doc.data?.description;
      if (typeof raw !== 'string') return null;
      const description = raw.trim();
      if (!description) return null;
      return {
        path: doc.filePath ?? '',
        domain: inferDomainFromPath(doc.filePath),
        description,
      };
    })
    .filter((r): r is { path: string; domain: string; description: string } => r !== null)
    .sort((a, b) => a.path.localeCompare(b.path));

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    (grouped.get(row.domain) ?? grouped.set(row.domain, []).get(row.domain)!).push(
      row.description
    );
  }

  const out: Record<string, string> = {};
  for (const [domain, parts] of grouped) {
    out[domain] = parts.join('\n\n');
  }
  return out;
}

/**
 * Extract repository config from blueprint root documents (v2.4).
 * Returns the first repository config found, or undefined.
 */
function extractRepositoryConfig(
  blueprintDocs?: ParsedBlueprintDocument[]
): RepositoryConfig | undefined {
  if (!blueprintDocs) return undefined;
  for (const doc of blueprintDocs) {
    const repo = doc.data?.repository as Record<string, unknown> | undefined;
    if (!repo || typeof repo !== 'object') continue;
    const url = repo.url as string | undefined;
    if (!url) continue;
    return {
      url,
      branch: repo.branch != null ? String(repo.branch) : undefined,
      provider: repo.provider != null ? String(repo.provider) : undefined,
    };
  }
  return undefined;
}

/**
 * Extract the multi-repository config map from blueprint root documents (v2.7.1).
 * Keyed by the code_ref org/repo prefix. Returns undefined when absent/empty.
 */
function extractRepositoriesConfig(
  blueprintDocs?: ParsedBlueprintDocument[]
): Record<string, RepositoryConfig> | undefined {
  if (!blueprintDocs) return undefined;
  for (const doc of blueprintDocs) {
    const repos = doc.data?.repositories as Record<string, unknown> | undefined;
    if (!repos || typeof repos !== 'object') continue;
    const out: Record<string, RepositoryConfig> = {};
    for (const [key, value] of Object.entries(repos)) {
      const repo = value as Record<string, unknown> | undefined;
      const url = repo?.url as string | undefined;
      if (!url) continue;
      out[key] = {
        url,
        branch: repo!.branch != null ? String(repo!.branch) : undefined,
        provider: repo!.provider != null ? String(repo!.provider) : undefined,
      };
    }
    if (Object.keys(out).length > 0) return out;
  }
  return undefined;
}
