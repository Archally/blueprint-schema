export type Severity = 'info' | 'warning' | 'error';

export interface PlannedChange {
  type: 'rename-file' | 'rename-directory' | 'edit-yaml' | 'remove-file';
  path: string;
  detail: string;
}

export interface UpdatePlan {
  sourceVersion: string;
  targetVersion: string;
  description: string;
  changes: PlannedChange[];
  warnings: string[];
}

export interface UpdateResult extends UpdatePlan {
  applied: boolean;
  errors: string[];
}

export interface SchemaUpdate {
  sourceVersion: string;
  targetVersion: string;
  description: string;
  plan(blueprintDir: string): UpdatePlan;
  apply(blueprintDir: string): UpdateResult;
}
