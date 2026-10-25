export interface ModelFileText { relFile: string; text: string }
export interface ModelVerdict {
  schemaErrors: string[];
  crossErrors: string[];
  referenceSuggestions: string[];
  warnings: string[];
  modelPath: string | undefined;
  filesValidated: number;
  filesSkipped: number;
  skippedFiles: string[];
  trackedRegister: unknown;
}
export interface TextValidationInput {
  files: readonly ModelFileText[];
  registry: Map<string, unknown>;
  model?: string;
  schemaVersion?: string | { major: number; minor: number };
  singleFile?: boolean;
  compat?: boolean;
}
export function validateModelTexts(args: TextValidationInput): ModelVerdict;
export function validateModel(args: { model: string; schemas: string; schemaVersion?: string; compat?: boolean; trackedRegister?: string }): ModelVerdict;
