export interface RenderedSection {
  title: string;
  content: string;
}

export interface RenderOptions {
  includeRelations?: boolean;
  includeMermaid?: boolean;
  includeGaps?: boolean;
  title?: string;
}
