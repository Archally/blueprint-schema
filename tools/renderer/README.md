# Blueprint Renderer

Generates a markdown report with embedded Mermaid diagrams from a blueprint model.

## Usage

```bash
# Render to stdout
blueprint-render .blueprint/v2.6

# Render to file
blueprint-render .blueprint/v2.6 -o .specs/overview.md

# Custom title, no diagrams
blueprint-render .blueprint/v2.6 -o report.md -t "My System" --no-mermaid

# Via npm script
npm run render:examples
```

## Output Sections

| Section | Content |
|---------|---------|
| **Causal Chains** | Mermaid graph: command → event → reaction flows |
| **Entity Graph** | Mermaid graph: all entities grouped by layer |
| **Context Map** | Mermaid graph: bounded context relationships |
| **Entity Catalog** | Table of all entities with type, layer, source |
| **Relations** | Table of all relations with source, type, target |
| **Coverage Gaps** | Orphan entities, commands without events, untested rules |

## Options

| Flag | Description |
|------|-------------|
| `--output`, `-o` | Output file path (default: stdout) |
| `--title`, `-t` | Report title |
| `--no-mermaid` | Omit Mermaid diagrams |
| `--no-relations` | Omit relation table |
| `--no-gaps` | Omit coverage gap analysis |

## Programmatic Use

```typescript
import { loadFromDirectory } from '@archally/blueprint-schema/model';
import { buildBlueprintModel } from '@archally/blueprint-schema/model';
import { renderBlueprint } from './render.js';

const loaded = loadFromDirectory('.blueprint/v2.6');
const model = buildBlueprintModel(loaded.documentsByType);
const markdown = renderBlueprint(model, { includeMermaid: true });
```
