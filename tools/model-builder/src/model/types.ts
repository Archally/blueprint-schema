/**
 * Parsed blueprint document: output of YAML parse, with optional path/scope.
 * Caller (backend or frontend) provides these; core does no I/O.
 */
export interface ParsedBlueprintDocument {
  data: Record<string, unknown>;
  filePath?: string;
  scope?: string;
}

/**
 * Entity in the internal blueprint model.
 * id is deterministic: {domain}-{file}-{displayId}.
 */
export interface Entity {
  id: string;
  displayId: string;
  type: string;
  layer: string;
  fileOrigin?: string;
  summary?: string;
  term?: string;
  description?: string;
  data?: Record<string, unknown>;
}

/**
 * Relation between two entities.
 */
export interface Relation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  type: string;
  predicate?: string;
  data?: Record<string, unknown>;
}

/**
 * File metadata for the blueprint (discovered files).
 */
export interface BlueprintFileMetadata {
  path: string;
  schemaType?: string;
  size?: number;
  lastModified?: string;
}

/**
 * Validation result attached to the model when validation was run.
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  warnings?: Array<{ path: string; message: string; filePath?: string }>;
}

/**
 * Migration pre-application validation result (errors reject, warnings report but allow).
 * Attached to model.metadata.migrationValidation when mode is to-be or point-in-time.
 */
export interface MigrationValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  warnings: Array<{ path: string; message: string }>;
}

/**
 * Repository configuration from blueprint root (v2.4).
 * Used to construct clickable links from code_refs to actual files.
 */
export interface RepositoryConfig {
  url: string;
  branch?: string;
  provider?: string;
}

/**
 * Metadata attached to the blueprint model.
 */
export interface BlueprintMetadata {
  files: BlueprintFileMetadata[];
  total_entities: number;
  total_relations: number;
  last_loaded: string | null;
  /** Project identifier. Set by backend/export-model when the project is known. */
  project_id?: string;
  /** Aggregated domain-slice descriptions keyed by inferred domain name. */
  domain_descriptions?: Record<string, string>;
  /** Present when validation was run (step-05). */
  validation?: ValidationResult;
  /** Present when migration validation was run (to-be or point-in-time). */
  migrationValidation?: MigrationValidationResult;
  /** Repository config from blueprint root (v2.4). */
  repository?: RepositoryConfig;
}

/**
 * Documents grouped by schema type (e.g. 'concepts', 'rules', 'arch').
 * Produced by groupDocumentsBySchemaType(); consumed by buildBlueprintModel().
 */
export type DocumentsBySchemaType = Record<string, ParsedBlueprintDocument[]>;

/**
 * Full blueprint model: entities, relations, metadata.
 * Produced by buildBlueprintModel(documents).
 */
export interface BlueprintModel {
  entities: Entity[];
  relations: Relation[];
  metadata: BlueprintMetadata;
}
