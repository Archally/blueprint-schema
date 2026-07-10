export type {
  ParsedBlueprintDocument,
  DocumentsBySchemaType,
  Entity,
  Relation,
  BlueprintFileMetadata,
  BlueprintMetadata,
  BlueprintModel,
  ValidationResult,
  MigrationValidationResult,
  RepositoryConfig,
} from './model/types.js';
export { ENTITY_TYPE, SCHEMA_TYPE_TO_LAYER } from './model/entityTypes.js';
export type { EntityType } from './model/entityTypes.js';
export { RELATION_TYPE } from './model/relationTypes.js';
export type { RelationType } from './model/relationTypes.js';
export { buildBlueprintModel, groupDocumentsBySchemaType } from './model/buildModel.js';
export { buildRelations } from './extraction/relations/index.js';
export { extractMembershipRelations, findMembershipGaps } from './extraction/relations/membership.js';
export type { MembershipGap } from './extraction/relations/membership.js';
export type { OperationDetail } from './extraction/entities/index.js';
export { applyMigrations, MigrationError, validateMigrations } from './migration/applyMigrations.js';
export type { MigrationToApply } from './migration/applyMigrations.js';
export { loadFromMap } from './loader-map.js';
export { loadFromDirectory } from './loader-fs.js';
