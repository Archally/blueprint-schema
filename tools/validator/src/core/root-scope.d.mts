/** The prefix every finding's message starts with, so a reader can select this class of warning. */
export const ROOT_SCOPE_PREFIX: "Root-level scope:";

/** A file at the model root whose `scope:` names no slice of the model. */
export interface RootScopeFinding {
  /** Path relative to the model root. */
  file: string;
  /** The `scope:` value as written. */
  scope: string;
  /** Whether the file declares `decisions`, so the message can name `decision_scope`. */
  holdsDecisions: boolean;
}

/** The slices a model has: the first path segment of every file below the model root. */
export function modelSlices(documents: Array<{ relFile: string }>): Set<string>;

/** One finding per root document whose `scope:` is a string naming none of the model's slices. */
export function rootScopeFindings(documents: Array<{ relFile: string; data: unknown }>): RootScopeFinding[];

/** The sentence every surface prints for one finding. */
export function rootScopeMessage(finding: RootScopeFinding): string;
