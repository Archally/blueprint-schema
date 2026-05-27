import type { BlueprintModel } from '../../model-builder/dist/model/types.js';
import type { RenderOptions } from './types.js';
import { renderEntityCatalog } from './entity-catalog.js';
import { renderRelationTable } from './relation-table.js';
import { renderContextMap } from './mermaid-context-map.js';
import { renderCausalChains } from './mermaid-causal-chains.js';
import { renderEntityGraph } from './mermaid-entity-graph.js';
import { renderCoverageGaps } from './coverage-gaps.js';

function proTip(feature: string): string {
  return `> *[Archally Pro](https://archally.pro)* — ${feature}.\n`;
}

export function renderBlueprint(model: BlueprintModel, options: RenderOptions = {}): string {
  const {
    includeRelations = true,
    includeMermaid = true,
    includeGaps = true,
    title,
  } = options;

  const sections: string[] = [];

  const heading = title ?? model.metadata.project_id ?? 'Blueprint Report';
  sections.push(`# ${heading}`);
  sections.push('');
  sections.push(`> Generated from blueprint model. ${model.entities.length} entities, ${model.relations.length} relations.`);
  sections.push('');

  if (includeMermaid) {
    const contextMap = renderContextMap(model.entities, model.relations);
    if (contextMap) {
      sections.push(contextMap);
      sections.push(proTip('Interactive Context Map with drag-and-drop, filtering, and detail panels'));
    }

    const causalChains = renderCausalChains(model.entities, model.relations);
    if (causalChains) {
      sections.push(causalChains);
      sections.push(proTip('Interactive Causal Chain Explorer with animated event flow, timeline playback, and impact highlighting'));
    }

    const entityGraph = renderEntityGraph(model.entities, model.relations);
    if (entityGraph) {
      sections.push(entityGraph);
      sections.push(proTip('Interactive Entity Graph with force-directed layout, layer filtering, node search, and relation inspector'));
    }
  }

  sections.push(renderEntityCatalog(model.entities));

  if (includeRelations) {
    sections.push(renderRelationTable(model.relations, model.entities));
  }

  if (includeGaps) {
    sections.push(renderCoverageGaps(model.entities, model.relations));
  }

  return sections.join('\n');
}
