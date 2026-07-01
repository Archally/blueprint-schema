/**
 * Blueprint Schema Atlas — intermediate model (IR) and shared contracts.
 *
 * The Atlas is a *generated projection* of the JSON Schema (DEC-ATL-02). JSON Schema
 * stays the single source of truth (DEC-ATL-01); these types never redefine validation
 * truth — they only describe what was read from schema so it can be projected to Markdown.
 *
 * Identity is hybrid (DEC-ATL-13): every element carries a source-true address
 * (`SourceRef`: file + JSON Pointer) for internal processing, and a stable Atlas
 * `slug`/`anchor` for documentation-facing links.
 */

/** The three top-level groupings a schema file can belong to. */
export type PlaneId = 'cross-cutting' | 'design' | 'governance';

/**
 * Source-true address of a schema element (DEC-ATL-13). `file` is the schema file
 * path relative to the version root (e.g. `design/domain.schema.yaml`); `pointer`
 * is a JSON Pointer within that file (`""` for the whole file, `/$defs/operation`
 * for a definition). `version` is the schema version slug (e.g. `v2.7`).
 */
export interface SourceRef {
  version: string;
  file: string;
  pointer: string;
}

/** Where a projected fact came from: schema sources (authoritative) + optional overlay contributions (non-authoritative). */
export interface Provenance {
  /** Schema source addresses this projection was derived from. Always at least one. */
  schema: SourceRef[];
  /** Overlay ids that contributed non-authoritative notes/examples, if any (DEC-ATL-12). */
  overlays?: string[];
}

/** A resolved type label for a property, kept human-readable and schema-faithful. */
export interface TypeInfo {
  /** Rendered label, e.g. `string`, `array<object>`, `ref → operation (CMD…)`, `union`. */
  label: string;
  /** Raw `$ref` when the type is a reference. */
  ref?: string;
  /** Target entity-type name when the ref resolves to a typed-ID vocabulary entry. */
  refEntityType?: string;
}

/** A single property of a schema object (root object or a `$defs` entry). */
export interface PropertyInfo {
  name: string;
  description?: string;
  required: boolean;
  type: TypeInfo;
  /** Enum values when the property (or its immediate items) constrains an enum. */
  enumValues?: string[];
  /** JSON Schema `deprecated: true`. */
  deprecated: boolean;
  /** JSON Pointer to this property within its file. */
  pointer: string;
}

/** A named definition under `$defs`. */
export interface DefInfo {
  /** Bare definition name (e.g. `operation`). */
  name: string;
  title?: string;
  description?: string;
  /** `object` when the def describes a shape with properties; `value` for scalar/ref/enum defs. */
  kind: 'object' | 'value';
  required: string[];
  properties: PropertyInfo[];
  /** Resolved type label — most useful for `value` defs (typed-ID refs, enums, scalars). */
  type: TypeInfo;
  enumValues?: string[];
  deprecated: boolean;
  pointer: string;
}

/** One schema file, normalized. Layer/slice/nesting boundaries are preserved (DEC-ATL-14). */
export interface SchemaFile {
  /** Path relative to the version root, POSIX form (e.g. `design/domain.schema.yaml`). */
  relPath: string;
  plane: PlaneId;
  /** Stable Atlas slug derived from relPath (e.g. `design-domain`). */
  slug: string;
  title: string;
  description?: string;
  rootType?: string;
  /** Root-level required property names. */
  required: string[];
  /** Root-level properties. */
  properties: PropertyInfo[];
  /** `$defs` entries. */
  definitions: DefInfo[];
  source: SourceRef;
}

/** A plane grouping with its member files. */
export interface Plane {
  id: PlaneId;
  title: string;
  description: string;
  files: string[];
}

/** A typed-ID vocabulary entry extracted from the metamodel (the model's "legend"). */
export interface EntityType {
  /** Metamodel `$defs` name, e.g. `concept_ref`. */
  name: string;
  /** ID prefix parsed from the pattern, e.g. `CN`, `CMD`, `EVT`. Empty when not derivable. */
  idPrefix: string;
  description?: string;
  source: SourceRef;
}

/** A cross-file reference edge (file → file) aggregated from `$ref` traversal. */
export interface FileRelation {
  fromFile: string;
  toFile: string;
  /** Number of `$ref`s in `fromFile` that target `toFile`. */
  count: number;
}

/** The full normalized Atlas model for one schema version. */
export interface AtlasModel {
  /** Version slug, e.g. `v2.7`. */
  version: string;
  /** Absolute path to the version's schema directory (source of truth). */
  schemaRoot: string;
  planes: Plane[];
  files: SchemaFile[];
  entityTypes: EntityType[];
  relations: FileRelation[];
}

// ---------------------------------------------------------------------------
// Overlay contract (DEC-ATL-08, DEC-ATL-17) — narrow, non-authoritative inputs.
// ---------------------------------------------------------------------------

/** The only overlay categories allowed (DEC-ATL-17). None may override validation truth. */
export type OverlayCategory =
  | 'explanatory-note'
  | 'modeling-guidance'
  | 'migration-note'
  | 'changelog-rationale'
  | 'curated-example'
  | 'rename-annotation';

/** A single overlay contribution, addressed to a source-true target. */
export interface OverlayEntry {
  category: OverlayCategory;
  /** Source-true target address this note/example attaches to (file[#pointer]). */
  target: string;
  /** Human note (markdown allowed) for note/guidance/migration/rationale categories. */
  note?: string;
  /** Curated example body for `curated-example`. */
  example?: string;
  /** For `rename-annotation`: the prior address that was renamed to `target`. */
  renamedFrom?: string;
}

/** A loaded, validated overlay document. */
export interface Overlay {
  id: string;
  description?: string;
  entries: OverlayEntry[];
}

// ---------------------------------------------------------------------------
// Diff / changelog contract (DEC-ATL-04, DEC-ATL-16, DEC-ATL-19).
// ---------------------------------------------------------------------------

export type ChangeKind =
  | 'add'
  | 'remove'
  | 'modify'
  | 'deprecate'
  | 'rename'
  | 'requiredness-change';

export type SemverImpact = 'major' | 'minor' | 'patch';

/** A single classified schema change between two versions. */
export interface ChangeEntry {
  kind: ChangeKind;
  /** Granularity of the changed element. */
  scope: 'file' | 'definition' | 'property';
  /** Human-readable target address (e.g. `design/domain.schema.yaml#/$defs/operation/materializes`). */
  target: string;
  /** Conservative semver impact (DEC-ATL-19). */
  semver: SemverImpact;
  /** One-line structural summary derived from the diff. */
  summary: string;
  /** Provenance to the affected schema element(s) in both versions where relevant. */
  provenance: Provenance;
  /** Optional curated rationale/migration note from a changelog overlay (DEC-ATL-17). */
  note?: string;
  /** For `rename`: the basis for the claim (always overlay-annotated here, DEC-ATL-19). */
  renameBasis?: string;
}

/** The full diff between two versions. */
export interface SchemaDiff {
  from: string;
  to: string;
  changes: ChangeEntry[];
}

// ---------------------------------------------------------------------------
// Policy (DEC-ATL-21) — explicit fail / warn / skip, never silent.
// ---------------------------------------------------------------------------

export type PolicyLevel = 'fail' | 'warn' | 'skip';

export interface PolicyEvent {
  level: PolicyLevel;
  /** Short machine-ish code, e.g. `diagram-split`, `rename-degraded`, `optional-skipped`. */
  code: string;
  message: string;
}
