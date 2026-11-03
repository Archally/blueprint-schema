# Blueprint Model Builder

TypeScript library that loads Blueprint YAML files and builds an in-memory model - a typed graph of entities and relations ready for downstream tools to consume.

## What It Does

1. **Parses** YAML files from a `.blueprint/` directory
2. **Groups** files by schema type (detected from filename)
3. **Extracts** typed entities
4. **Resolves** cross-file references and builds relations
5. **Returns** a `BlueprintModel` with entities, relations, and metadata

## Usage

```typescript
import { buildBlueprintModel, groupDocumentsBySchemaType } from '@archally/blueprint-schema/model';
import { loadFromMap } from '@archally/blueprint-schema/model';

// 1. Load YAML files into a Map (your responsibility - filesystem, API, etc.)
const fileMap = new Map([
  ["orders/concepts.yaml", yamlContent],
  ["orders/domain.yaml", yamlContent],
]);

// 2. Parse and group
const { documentsByType } = loadFromMap(fileMap);

// 3. Build model
const model = buildBlueprintModel(documentsByType);

// model.entities  - Entity[] (typed, with IDs, descriptions, raw data)
// model.relations - Relation[] (source → target with relation type)
// model.metadata  - file listing, entity counts, domain descriptions
```

## Key Types

### Entity

```typescript
interface Entity {
  id: string;              // Deterministic internal ID
  displayId: string;       // User-facing ID (CN001, CMD001, etc.)
  type: string;            // ENTITY_TYPE constant
  layer: string;           // Plane.layer (e.g. "design.concepts")
  fileOrigin?: string;     // Source file path
  term?: string;           // Display name
  summary?: string;        // One-line summary
  description?: string;    // Full description
  data?: Record<string, unknown>;  // Raw YAML fields
}
```

### Relation

```typescript
interface Relation {
  id: string;                  // {sourceId}--{type}--{targetId}
  source_entity_id: string;
  target_entity_id: string;
  type: string;                // RELATION_TYPE constant
  predicate?: string;          // Optional qualifier
  data?: Record<string, unknown>;
}
```

### BlueprintModel

```typescript
interface BlueprintModel {
  entities: Entity[];
  relations: Relation[];
  metadata: BlueprintMetadata;
}
```

## Entity Type Examples

Examples of declared entity types include the following. See [`ENTITY_TYPE`](src/model/entityTypes.ts) for the declared entity vocabulary.

Concepts, Actors, Enumerations, Associations, Operations (CMD/EVT/QRY/DOC), Rules (SR/CR/DR/EQ/VR/TR), Stories, Activities, User Stories, Use Cases, Questions, Errors, Models, Decisions, Business Decisions, Goals, Risks, Assumptions, Trade-offs, Inquiries, Test Cases, Capabilities, Value Streams, Milestones, Metrics, KPIs, SLOs, SLAs, Security, Compliance, Resilience, Screens, UI Actions, UI Navigation, Parties, Departments, Teams, Resources, Deployment Tiers, CodeFile (synthetic), Missing (placeholder).

## Relation Type Examples

Resolves supported cross-file references into typed relations. Examples include `produces`, `reacts_to`, `governed_by`, `declared_impact`, `validates`, `answered_by`, `code_ref`, `value_stream_capability`, and `resource_owner_team`.

See [`RELATION_TYPE`](src/model/relationTypes.ts) for the declared relation vocabulary.

## Architecture

```
src/
  index.ts                     - Public API exports
  parseYaml.ts                 - YAML parsing (yaml package)
  schemaTypes.ts               - Filename → schema type mapping
  loader-map.ts                - Map<path, content> → ParsedDocuments
  model/
    types.ts                   - Entity, Relation, BlueprintModel types
    entityTypes.ts             - ENTITY_TYPE constants
    relationTypes.ts           - RELATION_TYPE constants
    buildModel.ts              - buildBlueprintModel() orchestrator
    indexes.ts                 - O(1) lookup indexes by ID/type/layer
  extraction/
    entities/                  - Schema-specific entity extractors
    relations/                 - Relation extractors + reference resolver
  migration/                   - Migration application (as-is/to-be/point-in-time)
```

## CLI - Produce model.json

```bash
# Build a model.json from a blueprint directory (after `npm run build`)
node tools/model-builder/dist/cli.js .blueprint/v2.8 --output model.json --pretty

# Or pipe to stdout
node tools/model-builder/dist/cli.js .blueprint/v2.8 > model.json
```

| Flag | Description | Default |
|------|-------------|---------|
| `<path>` | Blueprint directory (positional) | `.blueprint/v2.8` |
| `--output`, `-o` | Write to file instead of stdout | stdout |
| `--pretty`, `-p` | Pretty-print JSON | compact |

The output `model.json` is the same IR (Intermediate Representation) used by Archally's viewers, MCP servers, and generators. Tools can consume this JSON to access the extracted entities and resolved relations.

## Building

```bash
npm run build   # tsc -p tools/model-builder/tsconfig.json
```

Output goes to `tools/model-builder/dist/`.
