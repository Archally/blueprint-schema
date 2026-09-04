export const SCHEMA_BASE_URI: string;

/**
 * Load every `*.schema.yaml` under a version root (or its `schema/` child), keyed by path relative
 * to the schema directory with POSIX separators.
 */
export function loadSchemaRegistry(versionRoot: string): { registry: Map<string, unknown>; schemaDir: string };

export function makeAjv(registry: Map<string, unknown>): unknown;
