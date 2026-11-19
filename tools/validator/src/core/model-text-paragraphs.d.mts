export interface ModelTextDocument { relFile: string; data: unknown }
export interface ModelTextSettings { maximumUnstructuredCharacters: number; narrativeFields: readonly string[] }
export interface ModelTextFinding {
  file: string; entityId: string; name: string; field: string; path: string; length: number; threshold: number;
}
export const MODEL_TEXT_RULE: 'model-text-paragraphs';
export function modelTextSubjects(documents: readonly ModelTextDocument[]): Array<{
  file: string; path: string; entityId: string; name: string; data: Record<string, unknown>; fields?: string[];
}>;
export function modelTextFindings(documents: readonly ModelTextDocument[], settings?: ModelTextSettings): ModelTextFinding[];
export function modelTextMessage(finding: ModelTextFinding): string;
